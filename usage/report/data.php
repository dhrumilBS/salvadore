<?php
/*
 * Usage report data: every session since ?since=<unix time> (0 = all), the
 * labels, the log's integrity check and a cursor for live.php to continue
 * from. Read-only. This PC only. The session fields match applyEntry() in
 * report.js, which keeps them up to date from live.php.
 */
require dirname(__DIR__) . '/lib.php';
usage_require_this_pc();
header('Content-Type: application/json');
header('Cache-Control: no-store');

$since = max(0, (int) ($_GET['since'] ?? 0));

$sessions = [];
$integrity = usage_read($since, function (array $e) use (&$sessions) {
    $key = $e['ip'] . '|' . $e['sid'];
    $s = &$sessions[$key];
    $s ??= ['key' => $key, 'ip' => $e['ip'], 'start' => $e['t'], 'end' => $e['t'], 'path' => $e['path'], 'tabs' => [],
        'open' => 0, 'active' => 0, 'activeAt' => 0, 'ua' => '', 'dev' => '', 'title' => '', 'ref' => '', 'fwd' => '',
        'closed' => false, 'past' => $e['ev'] === 'past'];
    $s['start'] = min($s['start'], $e['t']);
    $s['end'] = max($s['end'], $e['t']);
    $s['open'] = max($s['open'], $e['open'] ?? 0);
    if (($e['active'] ?? 0) > $s['active']) {
        $s['active'] = $e['active'];
        $s['activeAt'] = $e['t'];
    }
    if ($e['ev'] === 'start' || $e['ev'] === 'past') {
        foreach (['path', 'ua', 'dev', 'title', 'ref', 'fwd'] as $k) {
            $s[$k] = $e[$k] ?? $s[$k];
        }
    }
    if (($e['tab'] ?? '') !== '') {
        $s['tabs'][$e['tab']] = true;
    }
    if ($e['ev'] === 'end') {
        $s['closed'] = true;
    }
});

$out = [];
foreach ($sessions as $s) {
    $s['tool'] = usage_tool_for($s['path']);
    $s['tabs'] = array_keys($s['tabs']);
    $out[] = $s;
}
usort($out, fn($a, $b) => $b['start'] <=> $a['start']);

$labels = json_decode((string) @file_get_contents(usage_dir() . '/labels.json'), true) ?: [];

echo json_encode([
    'sessions'  => $out,
    'labels'    => (object) $labels,
    'integrity' => $integrity,
    'now'       => time(),
    'serverIp'  => $_SERVER['SERVER_ADDR'] ?? '',
    'logDir'    => usage_dir(),
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
