<?php
/*
 * The one live HTTP status checker for every tab - Content permalinks,
 * Links-tab URLs out of post_content, Redirect origins, and the opt-in
 * live-check filters on every CSV export all go through here.
 *
 * Links-tab URLs come straight out of post_content and can point anywhere on
 * the internet, so every check of an arbitrary URL must pass dw_check_plan()
 * first as an SSRF guard before curl ever touches it.
 */

/** Is this a globally routable address (not loopback/private/link-local/CGNAT/reserved, v4 or v6)? */
function dw_ip_is_public($ip)
{
    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        return false;
    }
    // IPv4-mapped IPv6 (::ffff:127.0.0.1) is judged by the IPv4 address inside it.
    if (preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i', $ip, $m)) {
        return dw_ip_is_public($m[1]);
    }
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        return false;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        // Ranges PHP's filter flags don't cover.
        $n = ip2long($ip);
        foreach ([['0.0.0.0', 8], ['100.64.0.0', 10], ['192.0.0.0', 24], ['198.18.0.0', 15]] as [$net, $bits]) {
            $mask = -1 << (32 - $bits);
            if (($n & $mask) === (ip2long($net) & $mask)) {
                return false;
            }
        }
        return true;
    }
    $v6 = strtolower($ip);
    return $v6 !== '::' && !preg_match('/^(fc|fd|fe[89ab])/', $v6);
}

/** The address to pin for a public DNS name, or null when it doesn't resolve or any of its addresses is non-public. */
function dw_resolve_public_host($host)
{
    static $cache = [];
    if (array_key_exists($host, $cache)) {
        return $cache[$host];
    }
    $ips = @gethostbynamel($host) ?: [];
    if (!$ips && function_exists('dns_get_record')) {
        $ips = array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6');
    }
    // A name that mixes public and internal records is refused outright, not
    // "pinned to the public one" - that's exactly what a rebinding setup looks like.
    foreach ($ips as $ip) {
        if (!dw_ip_is_public($ip)) {
            return $cache[$host] = null;
        }
    }
    return $cache[$host] = $ips[0] ?? null;
}

/**
 * Can this request live-check $url, and how? Returns null when refused, or
 * the CURLOPT_RESOLVE entry to pin the connection with ('' when there's
 * nothing to pin).
 *
 * - The current site's own host (its permalinks / redirect origins) is always
 *   allowed, resolved normally - the local snapshot's home can be localhost.
 * - Anything else (links out of post content can point anywhere) must be a
 *   public IP literal, or a real DNS name whose every address is public. The
 *   vetted address is pinned so curl can't resolve the name a second time to
 *   somewhere internal (DNS rebinding). Numeric/hex/short host spellings
 *   (2130706433, 0x7f000001, 127.1) aren't DNS names and are refused - curl
 *   would quietly turn them into loopback.
 * Redirects are never followed (CURLOPT_FOLLOWLOCATION off), so a vetted URL
 * can't bounce the check onto an internal address either.
 */
function dw_check_plan(mysqli $conn, $url)
{
    $p = parse_url((string) $url);
    $scheme = strtolower($p['scheme'] ?? '');
    if (!$p || !in_array($scheme, ['http', 'https'], true) || empty($p['host'])) {
        return null;
    }
    $host = strtolower(trim($p['host'], '[]'));

    $homeHost = strtolower((string) parse_url(dw_home_url($conn), PHP_URL_HOST));
    if ($homeHost !== '' && $host === $homeHost) {
        return '';
    }

    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return dw_ip_is_public($host) ? '' : null;
    }
    if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/', $host)) {
        return null;
    }
    $ip = dw_resolve_public_host($host);
    if ($ip === null) {
        return null;
    }
    $port = $p['port'] ?? ($scheme === 'https' ? 443 : 80);
    return sprintf('%s:%d:%s', $host, $port, str_contains($ip, ':') ? "[$ip]" : $ip);
}

/**
 * Split URLs into [url => pin] for the ones that may be checked, and a list of
 * refused ones - every bulk/export check goes through this.
 */
function dw_check_plans(mysqli $conn, array $urls)
{
    $allowed = [];
    $refused = [];
    foreach ($urls as $u) {
        $plan = dw_check_plan($conn, $u);
        if ($plan === null) {
            $refused[] = $u;
        } else {
            $allowed[$u] = $plan;
        }
    }
    return [$allowed, $refused];
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

/** curl options shared by the single-check and concurrent-check paths. $pin = a dw_check_plan() CURLOPT_RESOLVE entry. */
function dw_curl_opts($timeoutSec, $pin = '')
{
    $opts = [
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
    if ($pin !== '') {
        $opts[CURLOPT_RESOLVE] = [$pin];
    }
    return $opts;
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

/** One-off HEAD check of a single URL. Caller must have vetted it with dw_check_plan() and pass its pin. */
function dw_check_url_once($url, $timeoutSec = 8, $pin = '')
{
    $ch = curl_init($url);
    curl_setopt_array($ch, dw_curl_opts($timeoutSec, $pin));
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
 * $pins (url => dw_check_plan() entry) is required for anything that isn't the
 * site's own URL - pass dw_check_plans()' allowed map.
 */
function dw_check_urls_concurrent(array $urls, $concurrency = 20, $timeoutSec = 6, array $pins = [])
{
    $results = [];
    $queue   = array_values(array_unique($urls));
    $mh      = curl_multi_init();
    $handles = []; // (int) curl handle id => ['ch'=>..., 'url'=>...]

    $startNext = function () use (&$queue, &$handles, $mh, $timeoutSec, $pins) {
        $url = array_shift($queue);
        $ch = curl_init($url);
        curl_setopt_array($ch, dw_curl_opts($timeoutSec, $pins[$url] ?? ''));
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
