<?php
/*
 * Names for people in the usage report: POST {"ip": "<IP or d:<device id>>", "name": "..."}.
 * An empty name removes the label. Labels are a convenience, not part of the
 * signed log. This PC only, and only from the report page.
 */
require dirname(__DIR__) . '/lib.php';
usage_require_this_pc();
header('Content-Type: application/json');

$in = json_decode((string) file_get_contents('php://input'), true);
$ip = $in['ip'] ?? '';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_SERVER['HTTP_X_USAGE_REPORT'] ?? '') !== '1'
    || !(filter_var($ip, FILTER_VALIDATE_IP) || preg_match('/^d:[0-9a-f]{16}$/', $ip))) {
    http_response_code(400);
    exit('{"error":"Bad request"}');
}
$name = mb_substr(trim((string) preg_replace('/[\x00-\x1F\x7F]/u', '', (string) ($in['name'] ?? ''))), 0, 60);

$file = usage_dir() . '/labels.json';
$fh = fopen($file, 'c+');
flock($fh, LOCK_EX);
$labels = json_decode((string) stream_get_contents($fh), true) ?: [];
if ($name === '') {
    unset($labels[$ip]);
} else {
    $labels[$ip] = $name;
}
ftruncate($fh, 0);
rewind($fh);
fwrite($fh, json_encode((object) $labels, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
flock($fh, LOCK_UN);
fclose($fh);

echo json_encode(['labels' => (object) $labels], JSON_UNESCAPED_UNICODE);
