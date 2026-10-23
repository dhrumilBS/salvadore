<?php
/*
 * One-time import: page views from Apache's access.log (from before tracking
 * started) into the usage log as 'past' entries - who opened which tool page
 * and when. No time spent: Apache doesn't know that.
 *
 *   D:\xampp\php\php.exe D:\xampp\htdocs\salvadore\usage\import-apache.php [path\to\access.log]
 *
 * Old URLs (before the October 2026 restructure) are mapped to the current
 * tool folders, as in salvadore/.htaccess. Runs once: refuses if the log
 * already has imported entries.
 */
require __DIR__ . '/lib.php';
usage_require_cli();

$args = array_values(array_filter(array_slice($argv, 1), fn($a) => !str_starts_with($a, '--')));
$src = $args[0] ?? dirname(__DIR__, 3) . '/apache/logs/access.log';
$fh = @fopen($src, 'rb');
if (!$fh) {
    exit("Can't open $src\n");
}

$firstTracked = null;
$alreadyImported = false;
usage_read(0, function (array $e) use (&$firstTracked, &$alreadyImported) {
    if ($e['ev'] === 'past') {
        $alreadyImported = true;
    } else {
        $firstTracked = min($firstTracked ?? PHP_INT_MAX, $e['t']);
    }
});
if ($alreadyImported) {
    exit("Already imported - nothing done.\n");
}
$until = $firstTracked ?? time();

// Old folder -> current one (same as the redirects in salvadore/.htaccess).
$moves = [
    '#^healthray-sql/post-content(/|$)#'                                   => 'tools/healthray/master-dashboard/',
    '#^(?:healthray-sql|tools/healthray)/(?:menu-order|replace|focus-keyword)(/|$)#' => 'tools/healthray/master-dashboard/',
    '#^(?:healthray-sql|tools/healthray)/(?:stateCity|template)(?:/|$)#'   => 'tools/healthray/template-pages/',
    '#^(?:bigscal-section|tools/bigscal)/box(/|$)#'                        => 'tools/bigscal/',
    '#^healthray-sql(/|$)#'  => 'tools/healthray/',
    '#^botphonic-sql(/|$)#'  => 'tools/botphonic/',
    '#^bigscal-section(/|$)#' => 'tools/bigscal/',
    '#^html-css-js(/|$)#'    => 'tools/browser-snippets/',
    '#^timestamp(/|$)#'      => 'tools/timestamp/',
    '#^phonr(/|$)#'          => 'tools/phone-validator/',
    '#^img(/|$)#'            => 'tools/image-downloader/',
    '#^company(/|$)#'        => 'assets/brand/',
];

$entries = [];
// 1.2.3.4 - - [16/Jul/2026:11:15:18 +0530] "GET /salvadore/x/ HTTP/1.1" 200 123 "ref" "ua"
$re = '#^(\S+) \S+ \S+ \[([^\]]+)\] "GET (/salvadore/[^ ?"]*)(?:\?[^ "]*)? HTTP/[\d.]+" (200|304) \S+ "([^"]*)" "([^"]*)"#';
while (($line = fgets($fh)) !== false) {
    if (!preg_match($re, $line, $m)) {
        continue;
    }
    [, $ip, $time, $path, , $ref, $ua] = $m;
    // Pages only: folders, .html and index.php - not scripts, styles, images or API calls.
    if (!preg_match('#(/|\.html|/index\.php)$#', $path) || preg_match('#/(api|css|js|img|vendor)/#', $path)) {
        continue;
    }
    $t = DateTime::createFromFormat('d/M/Y:H:i:s O', $time);
    if (!$t || $t->getTimestamp() >= $until) {
        continue;
    }
    $rel = substr(urldecode($path), strlen('/salvadore/'));
    foreach ($moves as $from => $to) {
        if (preg_match($from, $rel)) {
            $rel = preg_replace($from, $to, $rel, 1);
            break;
        }
    }
    $entries[] = [
        't'    => $t->getTimestamp(),
        'ip'   => $ip,
        'ev'   => 'past',
        'sid'  => substr(md5($line), 0, 16),
        'path' => '/salvadore/' . $rel,
        'tab'  => '',
        'ref'  => mb_substr($ref === '-' ? '' : $ref, 0, 300),
        'ua'   => mb_substr($ua, 0, 300),
    ];
}
fclose($fh);

usort($entries, fn($a, $b) => $a['t'] <=> $b['t']);
if (in_array('--dry-run', $argv, true)) {
    $byPath = array_count_values(array_column($entries, 'path'));
    arsort($byPath);
    print_r(array_slice($byPath, 0, 25, true));
    exit(count($entries) . " page views would be imported. Nothing written.\n");
}
foreach (array_chunk($entries, 2000) as $chunk) {
    usage_append(...$chunk);
}
echo count($entries) . ' page views imported (before ' . date('Y-m-d H:i', $until) . ").\n";
