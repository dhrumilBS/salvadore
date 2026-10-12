<?php
/**
 * GET api/menu_types.php - Menu Order tab: post types that have published
 * items (with counts), minus plumbing types.
 * Response: { success, msg, post_types: [{ post_type, count }] }
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/menu_order.php';

json_out(true, 'Post types loaded', ['post_types' => mo_selectable_post_types($conn)]);
