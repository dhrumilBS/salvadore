<?php
require __DIR__ . '/bootstrap.php';

$postType = link_sanitize_post_type($_POST['post_type'] ?? $_GET['post_type'] ?? 'page');
$status   = link_sanitize_status($_POST['status'] ?? $_GET['status'] ?? 'all');
$where    = link_build_where($postType, $status);

$query = "SELECT
    p.ID AS id, p.post_type, p.post_name, p.post_title, p.menu_order,
    p.post_status, p.post_date, p.guid,
    MAX(CASE WHEN pm.meta_key = '_yoast_wpseo_title' THEN pm.meta_value END) AS meta_title,
    MAX(CASE WHEN pm.meta_key = '_yoast_wpseo_metadesc' THEN pm.meta_value END) AS meta_description
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE {$where}
GROUP BY p.ID
ORDER BY p.menu_order ASC, p.post_title ASC";

$res  = $conn->query($query);
$data = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

$data
    ? json_out(true, 'List Successful', ['data' => $data])
    : json_out(false, 'No data found');
