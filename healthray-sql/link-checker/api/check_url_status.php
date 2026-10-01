<?php
/**
 * GET api/check_url_status.php?url=... — on-demand live HTTP status check
 * for one link (301/404/410/etc). Browser-triggered only, never bundled
 * into list_posts.php — checking every link on every load would make a
 * page with hundreds of links impractically slow.
 */
require __DIR__ . '/bootstrap.php';

$url = trim((string) ($_GET['url'] ?? ''));
if ($url === '') {
    json_out(false, 'No URL provided');
}

if (!lc_is_safe_url($url)) {
    json_out(false, 'That URL is not allowed to be checked (must be a public http/https address).');
}

$result = lc_check_url_once($url, 8);
json_out(true, 'Checked', $result);
