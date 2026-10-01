<?php
/**
 * GET api/check_url_status.php?url=... - on-demand live HTTP status check
 * (301/404/410/etc) for one URL, used by every tab's single "Check" button.
 * Browser-triggered only, never bundled into a list endpoint - checking
 * every URL on every load would make large pages impractically slow.
 *
 * Allowed: this site's own URLs, or any other public http(s) URL (links found
 * in post content). Private/loopback/reserved addresses are refused - this is
 * not an open fetcher into the internal network.
 */
require __DIR__ . '/bootstrap.php';

$url = trim((string) ($_GET['url'] ?? ''));
if ($url === '') {
    json_out(false, 'No URL provided');
}

if (!dw_url_checkable($conn, $url)) {
    json_out(false, 'That URL is not allowed to be checked (must be a public http/https address).');
}

json_out(true, 'Checked', dw_check_url_once($url, 8));
