<?php
/**
 * POST api/check_links_bulk.php - concurrent live-status check for many URLs
 * at once (every tab's "Check all" button). Body: urls=<JSON array of
 * strings>. Capped at DW_BULK_MAX_URLS per call so one click can't turn into
 * an unbounded outbound request flood; callers with more than that queue
 * further batches themselves.
 */
require __DIR__ . '/bootstrap.php';
require_post_method();

const DW_BULK_MAX_URLS = 300;

$urls = json_decode((string) ($_POST['urls'] ?? ''), true);
if (!is_array($urls) || !array_is_list($urls)) {
    json_out(false, 'urls must be a JSON array of strings');
}

$urls = array_values(array_unique(array_filter(array_map(fn($u) => trim((string) $u), $urls))));
if (!$urls) {
    json_out(true, 'Nothing to check', ['results' => (object) []]);
}

$truncated = count($urls) > DW_BULK_MAX_URLS;
if ($truncated) {
    $urls = array_slice($urls, 0, DW_BULK_MAX_URLS);
}

$safe = [];
$results = [];
foreach ($urls as $u) {
    if (dw_url_checkable($conn, $u)) {
        $safe[] = $u;
    } else {
        $results[$u] = ['bucket' => 'blocked'] + dw_status_result(0, null);
    }
}

set_time_limit(0);
foreach (dw_check_urls_concurrent($safe, 15, 6) as $u => $info) {
    $results[$u] = dw_status_result($info['code'], $info['redirect_url']);
}

json_out(true, 'Checked', ['results' => $results, 'truncated' => $truncated]);
