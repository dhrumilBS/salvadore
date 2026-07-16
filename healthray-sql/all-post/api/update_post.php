<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'msg' => 'Invalid request method']);
    exit;
}

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$id     = isset($_POST['id']) ? (int) $_POST['id'] : 0;
$title  = $_POST['post_title']  ?? '';
$name   = $_POST['post_name']   ?? '';
$status = $_POST['post_status'] ?? 'publish';
$order  = isset($_POST['menu_order']) ? (int) $_POST['menu_order'] : 0;
$date   = $_POST['post_date']   ?? '';

if ($id <= 0) {
    echo json_encode(['success' => false, 'msg' => 'Invalid ID']);
    exit;
}

// Build the query dynamically so post_date is only touched when supplied & valid.
$setDate = '';
$types   = 'sssi';
$params  = [$title, $name, $status, $order];

if ($date !== '') {
    $ts = strtotime($date);
    if ($ts === false) {
        echo json_encode(['success' => false, 'msg' => 'Invalid date format']);
        exit;
    }
    $formatted = date('Y-m-d H:i:s', $ts);
    $setDate   = ', post_date = ?, post_date_gmt = ?';
    $types    .= 'ss';
    $params[]  = $formatted;
    $params[]  = gmdate('Y-m-d H:i:s', $ts);
}

$query = "UPDATE wp_posts
          SET post_title = ?, post_name = ?, post_status = ?, menu_order = ?{$setDate}
          WHERE ID = ?";

$stmt = $conn->prepare($query);
if (!$stmt) {
    echo json_encode(['success' => false, 'msg' => 'Prepare failed: ' . $conn->error]);
    exit;
}

$types   .= 'i';
$params[] = $id;
$stmt->bind_param($types, ...$params);

if ($stmt->execute()) {
    echo json_encode(['success' => true, 'msg' => "Post #$id updated successfully!"]);
} else {
    echo json_encode(['success' => false, 'msg' => 'Update failed: ' . $stmt->error]);
}
