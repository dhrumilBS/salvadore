<?php
/*
 * Concurrent HTTP status checking (curl_multi) for export.php's live
 * link-status filter. Checking every matching post's URL one at a time
 * would make a large export take forever - this keeps a rolling window
 * of concurrent requests instead. Only used when the export explicitly
 * opts into live-checking; never on the fast, DB-only export path.
 */
function dw_check_urls_concurrent(array $urls, $concurrency = 20, $timeoutSec = 6)
{
    $results = [];
    $queue   = array_values(array_unique($urls));
    $mh      = curl_multi_init();
    $handles = []; // (int) curl handle id => url

    $startNext = function () use (&$queue, &$handles, $mh, $timeoutSec) {
        $url = array_shift($queue);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_NOBODY => true,
            CURLOPT_CONNECTTIMEOUT => $timeoutSec,
            CURLOPT_TIMEOUT => $timeoutSec,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; DatewiseLinkChecker/1.0)',
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
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
                $results[$url] = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
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

/** Does an HTTP status code match a requested filter bucket (exact code, or "other" = anything not explicitly listed)? */
function dw_link_status_matches($code, array $wantedCodes, $wantOther)
{
    if (in_array((string) $code, $wantedCodes, true)) {
        return true;
    }
    $known = ['200', '301', '302', '404', '410'];
    return $wantOther && !in_array((string) $code, $known, true);
}
