<?php
require __DIR__ . '/bootstrap.php';

$postType = link_sanitize_post_type($_GET['post_type'] ?? 'all');
$status   = link_sanitize_status($_GET['status'] ?? 'publish');
$where    = link_build_where($postType, $status);

$sql = "SELECT
    p.ID AS id, p.post_title AS title, p.post_name AS slug, p.post_status AS status,
    MAX(CASE WHEN pm.meta_key = '_yoast_wpseo_title' THEN pm.meta_value END) AS meta_title,
    MAX(CASE WHEN pm.meta_key = '_yoast_wpseo_metadesc' THEN pm.meta_value END) AS meta_description
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE {$where}
GROUP BY p.ID
ORDER BY p.post_type, p.post_title";

$result   = $conn->query($sql);
$filename = "links-{$postType}-{$status}-" . date('Y-m-d') . '.csv';

header('Content-Type: text/csv; charset=utf-8');
header("Content-Disposition: attachment; filename=\"{$filename}\"");

$out = fopen('php://output', 'w');
fputcsv($out, ['Link', 'Post Title', 'Meta Title', 'Meta Description', 'Slug', 'Status']);

while ($row = $result->fetch_assoc()) {
    fputcsv($out, [
        'https://healthray.com/?p=' . $row['id'],
        $row['title'],
        $row['meta_title'],
        $row['meta_description'],
        $row['slug'],
        $row['status'],
    ]);
}

fclose($out);
