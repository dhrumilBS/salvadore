<?php
/**
 * GET api/kw_options.php - Focus Keyword tab: post types (with totals and
 * per-status counts), site-wide status totals, the status list and the
 * category terms (with counts) for the category filter.
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/focus_keyword.php';

$types = fk_post_type_options($conn);
if ($types === null) {
    http_response_code(500);
    json_out(false, 'Could not load post types');
}

$categories = fk_categories($conn);
if ($categories === null) {
    http_response_code(500);
    json_out(false, 'Could not load categories');
}

json_out(true, 'Options loaded', [
    'post_types'    => $types['post_types'],
    'status_counts' => $types['status_counts'],
    'statuses'      => dw_post_statuses(),
    'categories'    => $categories,
]);
