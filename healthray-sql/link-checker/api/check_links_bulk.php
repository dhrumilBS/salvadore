<?php
/**
 * POST api/check_links_bulk.php — concurrent live-status check for many
 * URLs at once ("Check all links on this page/post"). Body: urls=<JSON
 * array of strings>. Capped at MAX_URLS per call so one click can't turn
 * into an unbounded outbound request flood; callers with more than that
 * queue further batches themselves.
 */
require __DIR__ . '/bootstrap.php';
require_post_method();

const LC_BULK_MAX_URLS = 300;

$raw = $_POST['urls'] ?? '';
$urls = json_decode((string) $raw, true);
if (!is_array($urls) || !array_is_list($urls)) {
    json_out(false, 'urls must be a JSON array of strings');
}

$urls = array_values(array_unique(array_filter(array_map(fn($u) => trim((string) $u), $urls))));
if (!$urls) {
    json_out(true, 'Nothing to check', ['results' => (object) []]);
}

$truncated = count($urls) > LC_BULK_MAX_URLS;
if ($truncated) {
    $urls = array_slice($urls, 0, LC_BULK_MAX_URLS);
}

$safe = [];
$results = [];
foreach ($urls as $u) {
    if (lc_is_safe_url($u)) {
        $safe[] = $u;
    } else {
        $results[$u] = ['status_code' => 0, 'bucket' => 'blocked', 'redirect_url' => null];
    }
}

set_time_limit(0);
$checked = lc_check_urls_concurrent($safe, 15, 6);
foreach ($checked as $u => $info) {
    $results[$u] = [
        'status_code'  => $info['code'],
        'bucket'       => lc_bucket_for_code($info['code']),
        'redirect_url' => $info['redirect_url'],
    ];
}

json_out(true, 'Checked', ['results' => $results, 'truncated' => $truncated]);
