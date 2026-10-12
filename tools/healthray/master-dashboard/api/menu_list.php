<?php
/**
 * GET api/menu_list.php?type=<post_type> - Menu Order tab: every published
 * item of one post type, ordered the way WordPress orders them
 * (menu_order, then title). An unknown/unselectable type falls back to "page".
 * Response: { success, msg, post_type, site_url,
 *             items:   [{ id, title, slug, parent, menu_order, date, modified }],
 *             parents: [{ id, title, slug, parent }]  (parents outside the list) }
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/menu_order.php';

$allowed   = array_column(mo_selectable_post_types($conn), 'post_type');
$requested = $_GET['type'] ?? 'page';
$postType  = is_string($requested) && in_array($requested, $allowed, true) ? $requested : 'page';

$stmt = $conn->prepare(
    "SELECT ID, post_title, post_name, post_parent, menu_order, post_date, post_modified
     FROM wp_posts
     WHERE post_type = ? AND post_status = 'publish'
     ORDER BY menu_order ASC, post_title ASC"
);
$stmt->bind_param('s', $postType);
$stmt->execute();
$res = $stmt->get_result();

$items = [];
while ($row = $res->fetch_assoc()) {
    $items[] = [
        'id'         => (int) $row['ID'],
        'title'      => $row['post_title'],
        'slug'       => $row['post_name'],
        'parent'     => (int) $row['post_parent'],
        'menu_order' => (int) $row['menu_order'],
        'date'       => $row['post_date'],
        'modified'   => $row['post_modified'],
    ];
}

// Parents that aren't in the list (unpublished, or another type) still need a
// title + slug so URL paths and the parent filter can show them.
$known   = array_flip(array_column($items, 'id'));
$missing = array_values(array_unique(array_filter(
    array_column($items, 'parent'),
    fn($p) => $p > 0 && !isset($known[$p])
)));
$parents = [];
if ($missing) {
    $idList = implode(',', array_map('intval', $missing));
    $r = $conn->query("SELECT ID, post_title, post_name, post_parent FROM wp_posts WHERE ID IN ({$idList})");
    while ($r && $p = $r->fetch_assoc()) {
        $parents[] = ['id' => (int) $p['ID'], 'title' => $p['post_title'], 'slug' => $p['post_name'], 'parent' => (int) $p['post_parent']];
    }
}

json_out(true, 'Items loaded', [
    'post_type' => $postType,
    'site_url'  => rtrim((string) mo_wp_option($conn, 'siteurl'), '/'),
    'items'     => $items,
    'parents'   => $parents,
]);
