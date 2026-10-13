<?php
require __DIR__ . '/bootstrap.php';

// Only this site's own pages can be checked: the server makes the request, so
// an open "fetch any URL" endpoint would let anyone probe the office network.
$url = trim($_GET['url'] ?? '');
if ($url !== '' && !preg_match('#^https?://#i', $url)) {
    $url = TP_SITE_URL . '/' . ltrim($url, '/');   // "/some-slug/" or "some-slug"
}
$host = strtolower((string) parse_url($url, PHP_URL_HOST));
$siteHost = parse_url(TP_SITE_URL, PHP_URL_HOST);
if ($url === '' || !preg_match('#^https?://#i', $url) || ($host !== $siteHost && $host !== 'www.' . $siteHost)) {
    json_out(false, "Only {$siteHost} URLs can be checked", ['error' => "Only {$siteHost} URLs can be checked"]);
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_NOBODY => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; TemplatePagesStatusChecker/1.0)',
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
]);

curl_exec($ch);
$statusCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$redirectUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
curl_close($ch);

if ($redirectUrl && !preg_match('/^https?:\/\//', $redirectUrl)) {
    $parsed = parse_url($url);
    if ($parsed && isset($parsed['scheme'], $parsed['host'])) {
        $redirectUrl = $parsed['scheme'] . '://' . $parsed['host'] . $redirectUrl;
    }
}

json_out(true, 'Checked', [
    'url' => $url,
    'status_code' => $statusCode,
    'is_redirect' => ($statusCode >= 300 && $statusCode < 400),
    'is_gone' => ($statusCode === 410),
    'is_not_found' => ($statusCode === 404),
    'is_error' => ($statusCode === 0 || $statusCode >= 500),
    'redirect_url' => $redirectUrl ?: null,
]);
