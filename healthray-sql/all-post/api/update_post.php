<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

$id     = (int) ($_POST['id'] ?? 0);
$title  = $_POST['post_title']  ?? '';
$name   = $_POST['post_name']   ?? '';
$status = $_POST['post_status'] ?? 'publish';
$order  = (int) ($_POST['menu_order'] ?? 0);
$date   = $_POST['post_date']   ?? '';

if ($id <= 0) {
    json_out(false, 'Invalid ID');
}

// post_date is only touched when supplied & valid.
$setDate = '';
$types   = 'sssi';
$params  = [$title, $name, $status, $order];

if ($date !== '') {
    $ts = strtotime($date);
    if ($ts === false) {
        json_out(false, 'Invalid date format');
    }
    $setDate  = ', post_date = ?, post_date_gmt = ?';
    $types   .= 'ss';
    $params[] = date('Y-m-d H:i:s', $ts);
    $params[] = gmdate('Y-m-d H:i:s', $ts);
}

$stmt = $conn->prepare(
    "UPDATE wp_posts SET post_title = ?, post_name = ?, post_status = ?, menu_order = ?{$setDate} WHERE ID = ?"
);
if (!$stmt) {
    json_out(false, 'Prepare failed: ' . $conn->error);
}

$types   .= 'i';
$params[] = $id;
$stmt->bind_param($types, ...$params);

$stmt->execute()
    ? json_out(true, "Post #$id updated successfully!")
    : json_out(false, 'Update failed: ' . $stmt->error);
