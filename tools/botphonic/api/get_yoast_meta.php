<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    return json_encode(["Invalid request method"]);
}
require '../conn.php';

$sql = "SELECT p.*, pm.* 
        FROM wp_posts p 
        LEFT JOIN wp_postmeta pm 
        ON (pm.post_id = p.id) 
        WHERE
            pm.meta_key LIKE '%_yoast_wpseo_meta-robots-%'
            AND p.post_status = 'publish'";

$result = $conn->query($sql);
$data = [];

while ($row = $result->fetch_assoc()) {
    $data[] = $row;
}

echo json_encode(['data' => $data]);
