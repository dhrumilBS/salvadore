<?php
/**
 * GET api/overview.php - Overview tab: "what needs fixing on this site today?"
 * Read-only. Definitions live in lib/overview.php.
 *
 *   part   core | redirects | (omitted) = both
 *          The page requests the two parts in parallel so the slow one never
 *          holds the other back; each part opens its own connection.
 *   fresh  1 = ignore the redirect memo and recompute
 *
 * Response: success, site{key,label,live,home,name}, content, seo, revisions,
 * links, redirects (whichever parts were asked for), generated_at, ms, timings.
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirects.php';
require __DIR__ . '/lib/overview.php';

$t0 = microtime(true);
$part = $_GET['part'] ?? '';
if (!in_array($part, ['', 'core', 'redirects'], true)) {
    http_response_code(400);
    json_out(false, 'Invalid part');
}
$fresh = ($_GET['fresh'] ?? '') === '1';

$label = (string) ($DATABASES[$ACTIVE_DB]['label'] ?? $ACTIVE_DB);
$out = [
    'site' => [
        'key'   => $ACTIVE_DB,
        'label' => $label,
        'live'  => (bool) preg_match('/\blive\b/i', $label),
    ],
];
$timings = [];

try {
    if ($part === '' || $part === 'core') {
        $t = microtime(true);
        $core = ov_core($conn);
        $out['site']['home'] = $core['site_home'];
        $out['site']['name'] = $core['site_name'];
        unset($core['site_home'], $core['site_name']);
        $out += $core;
        $timings['core'] = round((microtime(true) - $t) * 1000);
    }
    if ($part === '' || $part === 'redirects') {
        $t = microtime(true);
        $out['redirects'] = ov_redirects($conn, $ACTIVE_DB, $fresh);
        $out['redirects']['by_type'] = (object) $out['redirects']['by_type'];
        $timings['redirects'] = round((microtime(true) - $t) * 1000);
    }
} catch (Throwable $e) {
    error_log('overview.php: ' . $e->getMessage());
    http_response_code(500);
    json_out(false, 'Could not compute the overview');
}

// Whole request including the DB connect in bootstrap.php (ms below starts after it).
$timings['request'] = round((microtime(true) - ($_SERVER['REQUEST_TIME_FLOAT'] ?? $t0)) * 1000);

json_out(true, 'Overview loaded', $out + [
    'part'         => $part === '' ? 'all' : $part,
    'generated_at' => date('c'),
    'ms'           => round((microtime(true) - $t0) * 1000),
    'timings'      => $timings,
]);
