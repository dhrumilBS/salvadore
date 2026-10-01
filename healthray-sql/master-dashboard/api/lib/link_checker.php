<?php
/*
 * The one live HTTP status checker for every tab - Content permalinks,
 * Links-tab URLs out of post_content, Redirect origins, and the opt-in
 * live-check filters on every CSV export all go through here.
 *
 * Links-tab URLs come straight out of post_content and can point anywhere on
 * the internet, so every check of an arbitrary URL must pass dw_is_safe_url()
 * first as an SSRF guard before curl ever touches it.
 */

/**
 * Reject anything that isn't a public http(s) URL: no other schemes, no
 * loopback/private/link-local/reserved IP ranges (directly, or via a
 * hostname that resolves to one).
 */
function dw_is_safe_url($url)
{
    $parts = parse_url((string) $url);
    if (!$parts || empty($parts['scheme']) || !in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        return false;
    }
    $host = $parts['host'] ?? '';
    if ($host === '' || strcasecmp($host, 'localhost') === 0) {
        return false;
    }

    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : @gethostbyname($host);
    if (filter_var($ip, FILTER_VALIDATE_IP)) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;
        }
    }
    return true;
}

/**
 * May this request live-check $url? Either it is on the current site's own
 * host (its permalinks / redirect origins - always allowed, exactly like the
 * old own-site-only check), or it is a safe public URL.
 */
function dw_url_checkable(mysqli $conn, $url)
{
    $homeHost = parse_url(dw_home_url($conn), PHP_URL_HOST);
    $urlHost  = parse_url((string) $url, PHP_URL_HOST);
    $scheme   = strtolower((string) parse_url((string) $url, PHP_URL_SCHEME));
    if ($homeHost && $urlHost && strcasecmp($homeHost, $urlHost) === 0 && in_array($scheme, ['http', 'https'], true)) {
        return true;
    }
    return dw_is_safe_url($url);
}

/** HTTP status code -> display bucket, shared by single + bulk checks and CSV export. */
function dw_bucket_for_code($code)
{
    $code = (int) $code;
    if ($code >= 200 && $code < 300) {
        return 'ok';
    }
    if ($code >= 300 && $code < 400) {
        return 'redirect';
    }
    if ($code >= 400) {
        return 'broken';
    }
    return 'error';
}

/** curl options shared by the single-check and concurrent-check paths. */
function dw_curl_opts($timeoutSec)
{
    return [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_NOBODY         => true,
        CURLOPT_CONNECTTIMEOUT => $timeoutSec,
        CURLOPT_TIMEOUT        => $timeoutSec,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; MasterDashboardLinkChecker/1.0)',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ];
}

/** Resolve a possibly-relative Location header against the URL it came from. */
function dw_resolve_redirect($url, $redirect)
{
    if (!$redirect || preg_match('#^https?://#i', $redirect)) {
        return $redirect ?: null;
    }
    $p = parse_url($url);
    if ($p && isset($p['scheme'], $p['host'])) {
        return $p['scheme'] . '://' . $p['host'] . $redirect;
    }
    return $redirect;
}

/** Shape one result the way every check endpoint returns it. */
function dw_status_result($code, $redirectUrl)
{
    $code = (int) $code;
    return [
        'status_code'  => $code,
        'bucket'       => dw_bucket_for_code($code),
        'redirect_url' => $redirectUrl,
        'is_redirect'  => $code >= 300 && $code < 400,
        'is_gone'      => $code === 410,
        'is_not_found' => $code === 404,
        'is_error'     => $code === 0 || $code >= 500,
    ];
}

/** One-off HEAD check of a single URL. Caller must have already validated it (dw_url_checkable). */
function dw_check_url_once($url, $timeoutSec = 8)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, dw_curl_opts($timeoutSec));
    curl_exec($ch);
    $code     = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $redirect = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);

    return dw_status_result($code, dw_resolve_redirect($url, $redirect));
}

/**
 * Concurrent (curl_multi) HEAD check of many URLs - a rolling window of
 * $concurrency requests instead of one at a time, so checking hundreds of
 * URLs doesn't take minutes. Returns url => ['code'=>int,'redirect_url'=>?string].
 */
function dw_check_urls_concurrent(array $urls, $concurrency = 20, $timeoutSec = 6)
{
    $results = [];
    $queue   = array_values(array_unique($urls));
    $mh      = curl_multi_init();
    $handles = []; // (int) curl handle id => ['ch'=>..., 'url'=>...]

    $startNext = function () use (&$queue, &$handles, $mh, $timeoutSec) {
        $url = array_shift($queue);
        $ch = curl_init($url);
        curl_setopt_array($ch, dw_curl_opts($timeoutSec));
        curl_multi_add_handle($mh, $ch);
        $handles[(int) $ch] = ['ch' => $ch, 'url' => $url];
    };

    while (count($handles) < $concurrency && $queue) {
        $startNext();
    }

    while ($handles) {
        do {
            $status = curl_multi_exec($mh, $running);
        } while ($status === CURLM_CALL_MULTI_PERFORM);

        if ($running) {
            curl_multi_select($mh, 1.0);
        }

        while ($info = curl_multi_info_read($mh)) {
            $ch  = $info['handle'];
            $key = (int) $ch;
            $url = $handles[$key]['url'] ?? null;
            if ($url !== null) {
                $results[$url] = [
                    'code'         => (int) curl_getinfo($ch, CURLINFO_HTTP_CODE),
                    'redirect_url' => dw_resolve_redirect($url, curl_getinfo($ch, CURLINFO_REDIRECT_URL)),
                ];
            }
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            unset($handles[$key]);

            if ($queue) {
                $startNext();
            }
        }
    }

    curl_multi_close($mh);
    return $results;
}

/**
 * Parse an export's opt-in "link_status" param ("200,301,other") into
 * [wantedCodes, wantOther, isOn]. "other" = anything outside 200/301/302/404/410.
 */
function dw_parse_link_status_filter($raw)
{
    $wanted    = array_values(array_filter(array_map('trim', explode(',', (string) $raw))));
    $wantOther = in_array('other', $wanted, true);
    $wanted    = array_values(array_diff($wanted, ['other']));
    return [$wanted, $wantOther, (bool) $wanted || $wantOther];
}

/** Does an HTTP status code match a requested filter bucket (exact code, or "other" = anything not explicitly listed)? */
function dw_link_status_matches($code, array $wantedCodes, $wantOther)
{
    if (in_array((string) $code, $wantedCodes, true)) {
        return true;
    }
    $known = ['200', '301', '302', '404', '410'];
    return $wantOther && !in_array((string) $code, $known, true);
}
