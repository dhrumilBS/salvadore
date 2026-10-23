<?php
/*
 * Receives events from track.js and appends them to the usage log.
 * Open to everyone (it has to record outside visitors too), so it trusts
 * nothing from the request except the shape: the IP is the connection's own
 * address and the browser string comes from the request header.
 * Limits: USAGE_RATE_PER_MINUTE events per IP, USAGE_MAX_MONTH_BYTES per
 * month file, and browsers must be on this site (another website can't post here).
 */
require __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit;
}
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) {
    http_response_code(403);
    exit;
}
if (!usage_rate_ok($_SERVER['REMOTE_ADDR'] ?? '')) {
    http_response_code(429);
    exit;
}
if (@filesize(usage_dir() . '/' . gmdate('Y-m') . '.log') > USAGE_MAX_MONTH_BYTES) {
    http_response_code(507);
    exit;
}

$raw = file_get_contents('php://input', false, null, 0, 4096);
$in = json_decode((string) $raw, true);
$str = fn($v, $max) => is_string($v) ? mb_substr((string) preg_replace('/[\x00-\x1F\x7F]/u', '', $v), 0, $max) : '';
$int = fn($v) => is_int($v) ? max(0, min($v, 86400)) : 0;

$path = $str($in['path'] ?? '', 300);
if (
    !is_array($in)
    || !in_array($in['ev'] ?? '', USAGE_EVENTS, true)
    || !preg_match('/^[0-9a-f]{16}$/', $in['sid'] ?? '')
    || !str_starts_with($path, '/salvadore/')
) {
    http_response_code(400);
    exit;
}

$entry = [
    't'    => time(),
    'ip'   => $_SERVER['REMOTE_ADDR'] ?? '',
    'ev'   => $in['ev'],
    'sid'  => $in['sid'],
    'path' => $path,
    'tab'  => preg_match('/^#[\w-]{1,40}$/', $in['tab'] ?? '') ? $in['tab'] : '',
];
if ($in['ev'] === 'start') {
    $entry['title'] = $str($in['title'] ?? '', 120);
    $entry['ref'] = $str($in['ref'] ?? '', 300);
    $entry['ua'] = $str($_SERVER['HTTP_USER_AGENT'] ?? '', 300);
    // Random ID kept in the browser: tells apart people sharing an IP, follows one person across IPs.
    if (preg_match('/^[0-9a-f]{16}$/', $in['dev'] ?? '')) {
        $entry['dev'] = $in['dev'];
    }
    // Recorded as given - only meaningful if a proxy you run set it.
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $entry['fwd'] = $str($_SERVER['HTTP_X_FORWARDED_FOR'], 100);
    }
} else {
    $entry['active'] = $int($in['active'] ?? 0);
    $entry['open'] = $int($in['open'] ?? 0);
}

usage_append($entry);
http_response_code(204);
