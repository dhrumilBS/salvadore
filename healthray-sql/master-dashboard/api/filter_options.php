<?php
/**
 * GET api/filter_options.php - shared by every tab: real content post types
 * (with counts, for the Links tab's dropdown) and the status list (value =>
 * label, for every Status filter).
 */
require __DIR__ . '/bootstrap.php';

json_out(true, 'Filter options loaded', [
    'post_types' => dw_known_post_types_with_counts($conn),
    'statuses'   => dw_post_statuses(),
]);
