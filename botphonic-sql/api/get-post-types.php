<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/botphonic-sql/conn.php';

header("Content-Type: application/json");

// Fetch unique post types
$sql = "SELECT DISTINCT post_type FROM wp_posts ORDER BY post_type ASC";
$result = $conn->query($sql);

$postTypes = [];
while ($row = $result->fetch_assoc()) {
    $postTypes[] = $row['post_type'];
}

echo json_encode([
    "post_types" => $postTypes
]);
