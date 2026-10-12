<?php
/**
 * GET api/kw_list.php - Focus Keyword tab: every post of one type/status with
 * its Yoast focus keyword, categories, real URL and a duplicate flag (same
 * keyword, case-insensitive, used more than once in this type/status).
 *
 *   post_type       default 'post'
 *   post_status     default 'publish'; 'any' = every status but auto-draft/inherit
 *   only_duplicate  1 = only rows whose keyword is duplicated
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/focus_keyword.php';

$postType   = $_GET['post_type'] ?? 'post';
$postStatus = $_GET['post_status'] ?? 'publish';
$onlyDup    = ($_GET['only_duplicate'] ?? '') === '1';

if (!is_string($postType) || !preg_match('/^[a-z0-9_\-]{1,40}$/i', $postType)) {
    http_response_code(400);
    json_out(false, 'Invalid post type');
}
if (!is_string($postStatus) || !preg_match('/^[a-z0-9_\-]{0,40}$/i', $postStatus)) {
    http_response_code(400);
    json_out(false, 'Invalid post status');
}
$anyStatus = ($postStatus === '' || $postStatus === 'any');

$t0 = microtime(true);
$result = fk_fetch_keyword_rows($conn, $postType, $anyStatus ? 'any' : $postStatus, $onlyDup);
if ($result === null) {
    http_response_code(500);
    json_out(false, 'Could not load posts');
}
$serverMs = round((microtime(true) - $t0) * 1000, 1);

json_out(true, 'Posts loaded', [
    'post_type'      => $postType,
    'post_status'    => $anyStatus ? 'any' : $postStatus,
    'only_duplicate' => $onlyDup,
    'site_home'      => $result['site_home'],
    'server_time_ms' => $serverMs,
    'row_count'      => count($result['rows']),
    'data'           => $result['rows'],
    'keywordCount'   => (object) $result['keywordCount'],
]);
