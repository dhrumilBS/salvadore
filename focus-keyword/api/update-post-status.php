<?php

/**
 * Updates the post_status of one or many posts (bulk or single).
 * Expects:
 *   ids    - comma / whitespace separated post IDs
 *   status - one of: publish | draft | trash | pending | private
 *   conn   - healthray | botphonic | local
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "error" => "POST method required"]);
    exit;
}

require __DIR__ . '/../auth.php';
fk_require_api_auth();
require __DIR__ . '/conn.php';
header("Content-Type: application/json");

$allowed = ['publish', 'draft', 'trash', 'pending', 'private'];
$status  = $_POST['status'] ?? '';

if (!in_array($status, $allowed, true)) {
    echo json_encode([
        "status" => "error",
        "error"  => "Invalid status. Allowed: " . implode(', ', $allowed),
    ]);
    exit;
}

$idsRaw = $_POST['ids'] ?? '';
$ids = array_values(array_unique(array_filter(
    array_map('intval', preg_split('/[\s,]+/', trim($idsRaw))),
    fn($v) => $v > 0
)));

if (empty($ids)) {
    echo json_encode(["status" => "error", "error" => "No valid post IDs provided"]);
    exit;
}

$placeholders = implode(',', array_fill(0, count($ids), '?'));
$types        = 's' . str_repeat('i', count($ids));

$sql = "UPDATE wp_posts
    SET post_status = ?,
        post_modified = NOW(),
        post_modified_gmt = UTC_TIMESTAMP()
    WHERE ID IN ($placeholders)";

$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "error" => $conn->error]);
    exit;
}

$stmt->bind_param($types, $status, ...$ids);

if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(["status" => "error", "error" => $stmt->error]);
    exit;
}

$affected = $stmt->affected_rows;
$stmt->close();

echo json_encode([
    "database"      => $DB_KEY,
    "status"        => "success",
    "new_status"    => $status,
    "ids"           => $ids,
    "affected_rows" => $affected,
]);
exit;
