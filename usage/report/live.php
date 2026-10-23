<?php
/*
 * Live updates for the report: the log entries written after a cursor
 * (?file=YYYY-MM.log&offset=<bytes>&h=<signature of the line before>), each
 * with its tool name, plus the cursor to ask from next time. The new lines'
 * signatures are checked against h, so "ok": false means the log changed
 * underneath the page and it should reload in full. Read-only. This PC only.
 */
require dirname(__DIR__) . '/lib.php';
usage_require_this_pc();
header('Content-Type: application/json');
header('Cache-Control: no-store');

$from = ['file' => (string) ($_GET['file'] ?? ''), 'offset' => (int) ($_GET['offset'] ?? 0), 'h' => (string) ($_GET['h'] ?? '')];
if (!preg_match('/^(\d{4}-\d{2}\.log)?$/', $from['file']) || !preg_match('/^([0-9a-f]{64}|genesis)$/', $from['h']) || $from['offset'] < 0) {
    http_response_code(400);
    exit('{"error":"Bad cursor"}');
}

$entries = [];
$scan = usage_scan($from, function (array $e) use (&$entries) {
    $e['tool'] = usage_tool_for($e['path']);
    $entries[] = $e;
});

echo json_encode([
    'ok'      => !$scan['broken'],
    'entries' => $entries,
    'cursor'  => $scan['cursor'],
    'now'     => time(),
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
