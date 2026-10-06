<?php
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/../../conn.php';

$url = trim($_GET['url'] ?? '');
if (!$url) {
    echo json_encode(['success' => false, 'error' => 'No URL provided']);
    exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_NOBODY => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; StateCityStatusChecker/1.0)',
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

echo json_encode([
    'success' => true,
    'url' => $url,
    'status_code' => $statusCode,
    'is_redirect' => ($statusCode >= 300 && $statusCode < 400),
    'is_gone' => ($statusCode === 410),
    'is_not_found' => ($statusCode === 404),
    'is_error' => ($statusCode === 0 || $statusCode >= 500),
    'redirect_url' => $redirectUrl ?: null,
]);
