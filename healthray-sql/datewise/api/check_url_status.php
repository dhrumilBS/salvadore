<?php
require __DIR__ . '/bootstrap.php';

/*
 * Live link-status check (301/404/410/etc) for one URL at a time - this is
 * a browser-triggered, on-demand check, never bundled into list_posts.php
 * or export.php: checking thousands of URLs synchronously during a bulk
 * export would make large exports impractically slow.
 */

$url = trim((string) ($_GET['url'] ?? ''));
if ($url === '') {
    json_out(false, 'No URL provided');
}

// Only ever check this site's own permalinks - no open URL fetcher.
$home     = dw_home_url($conn);
$homeHost = parse_url($home, PHP_URL_HOST);
$urlHost  = parse_url($url, PHP_URL_HOST);
if (!$homeHost || !$urlHost || strcasecmp($homeHost, $urlHost) !== 0) {
    json_out(false, 'URL must be on this site');
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_NOBODY => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; DatewiseLinkChecker/1.0)',
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
]);
curl_exec($ch);
$statusCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$redirectUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
curl_close($ch);

if ($redirectUrl && !preg_match('#^https?://#i', $redirectUrl)) {
    $parsed = parse_url($url);
    if ($parsed && isset($parsed['scheme'], $parsed['host'])) {
        $redirectUrl = $parsed['scheme'] . '://' . $parsed['host'] . $redirectUrl;
    }
}

json_out(true, 'Checked', [
    'status_code'  => $statusCode,
    'is_redirect'  => ($statusCode >= 300 && $statusCode < 400),
    'is_gone'      => ($statusCode === 410),
    'is_not_found' => ($statusCode === 404),
    'is_error'     => ($statusCode === 0 || $statusCode >= 500),
    'redirect_url' => $redirectUrl ?: null,
]);
