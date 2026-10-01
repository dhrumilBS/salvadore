<?php
/*
 * Live HTTP status checking. Unlike datewise's link_checker.php (which only
 * ever re-checks a site's own permalinks), the URLs here come straight out
 * of post_content and can point anywhere on the internet — so every check
 * goes through lc_is_safe_url() first as an SSRF guard before curl ever
 * touches it.
 */

/**
 * Reject anything that isn't a public http(s) URL: no other schemes, no
 * loopback/private/link-local/reserved IP ranges (directly, or via a
 * hostname that resolves to one). Used by both the single-URL and bulk
 * checkers so a post's link can never be used to probe internal services.
 */
function lc_is_safe_url($url)
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

/** HTTP status code -> display bucket, shared by single + bulk checks and CSV export. */
function lc_bucket_for_code($code)
{
    $code = (int) $code;
    if ($code === 0) {
        return 'error';
    }
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
function lc_curl_opts($timeoutSec)
{
    return [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_NOBODY         => true,
        CURLOPT_CONNECTTIMEOUT => $timeoutSec,
        CURLOPT_TIMEOUT        => $timeoutSec,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; LinkCheckerTool/1.0)',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ];
}

/** Resolve a possibly-relative Location header against the URL it came from. */
function lc_resolve_redirect($url, $redirect)
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

/** One-off HEAD check of a single URL. Caller must have already validated it with lc_is_safe_url(). */
function lc_check_url_once($url, $timeoutSec = 8)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, lc_curl_opts($timeoutSec));
    curl_exec($ch);
    $code     = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $redirect = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);

    return [
        'status_code'  => $code,
        'bucket'       => lc_bucket_for_code($code),
        'redirect_url' => lc_resolve_redirect($url, $redirect),
    ];
}

/**
 * Concurrent (curl_multi) HEAD check of many URLs — a rolling window of
 * $concurrency requests instead of one at a time, so checking hundreds of
 * links doesn't take minutes. Returns url => ['code'=>int,'redirect_url'=>?string].
 */
function lc_check_urls_concurrent(array $urls, $concurrency = 15, $timeoutSec = 6)
{
    $results = [];
    $queue   = array_values(array_unique($urls));
    $mh      = curl_multi_init();
    $handles = []; // (int) curl handle id => ['ch'=>..., 'url'=>...]

    $startNext = function () use (&$queue, &$handles, $mh, $timeoutSec) {
        $url = array_shift($queue);
        $ch = curl_init($url);
        curl_setopt_array($ch, lc_curl_opts($timeoutSec));
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
                $code     = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $redirect = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
                $results[$url] = [
                    'code'         => $code,
                    'redirect_url' => lc_resolve_redirect($url, $redirect),
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
