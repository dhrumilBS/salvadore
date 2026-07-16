<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../conn.php';

$conn->set_charset("utf8mb4");

$page = max(1, intval($_GET['page'] ?? 1));
$perPage = $_GET['perPage'] ? $_GET['perPage'] : 100;
$offset = ($page - 1) * $perPage;

$postQuery = " AND post_content LIKE '%\"sizeSlug\":\"large\"%'";

$countSql = "SELECT COUNT(ID) AS total FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish'  AND post_content = ''";
$countResult = $conn->query($countSql);
$totalCount = 0;
if ($countResult) {
    $countRow = $countResult->fetch_assoc();
    $totalCount = intval($countRow['total'] ?? 0);
}

$sql = "SELECT ID, post_title,guid, post_content FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish' ORDER BY ID ASC LIMIT {$perPage} OFFSET {$offset}";
$result = $conn->query($sql);

if (!$result) {

    http_response_code(500);

    echo json_encode([
        "status" => "error",
        "message" => $conn->error
    ]);

    exit;
}

$data = [];

while ($row = $result->fetch_assoc()) {
    $data[] = $row;
}

$totalPages = $totalCount > 0 ? (int) ceil($totalCount / $perPage) : 1;

echo json_encode([
    "status" => "success",
    "get" => $_GET,
    "page" => $page,
    "per_page" => $perPage,
    "total" => $totalCount,
    "total_pages" => $totalPages,
    "count" => count($data),
    "data" => $data
], JSON_UNESCAPED_UNICODE);