<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

$id     = (int) ($_POST['id'] ?? 0);
$title  = $_POST['post_title']  ?? '';
$name   = $_POST['post_name']   ?? '';
$status = $_POST['post_status'] ?? 'publish';

if ($id <= 0) {
    json_out(false, 'Invalid ID');
}

$stmt = $conn->prepare('UPDATE wp_posts SET post_title = ?, post_name = ?, post_status = ? WHERE ID = ?');
if (!$stmt) {
    json_out(false, 'Prepare failed: ' . $conn->error);
}

$stmt->bind_param('sssi', $title, $name, $status, $id);

$stmt->execute()
    ? json_out(true, "Post #$id updated successfully!")
    : json_out(false, 'Update failed: ' . $stmt->error);
