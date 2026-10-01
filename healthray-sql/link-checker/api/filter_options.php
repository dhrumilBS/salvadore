<?php
/**
 * GET api/filter_options.php — post types (dynamic, from wp_posts) and the
 * post-status list, for the Post Type / Status dropdowns.
 */
require __DIR__ . '/bootstrap.php';

json_out(true, 'Filter options loaded', [
    'post_types' => lc_known_post_types($conn, $prefix),
    'statuses'   => lc_post_statuses(),
]);
