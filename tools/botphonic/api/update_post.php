<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    return json_encode(["Invalid request method"]);
}

require './../conn.php';

$id = $_POST['id'];
$title = $_POST['post_title'];
$name = $_POST['post_name'];
$status = $_POST['post_status'];
$order = $_POST['menu_order'];
$date = $_POST['post_date'];

if (!$id) {
    echo json_encode(['success' => false, 'msg' => 'Invalid ID']);
    exit;
}

$query = "UPDATE wp_posts 
          SET post_title = ?, post_name = ?, post_date = ?, post_status = ?, 
          menu_order = ? WHERE ID = ?";
$stmt = $conn->prepare($query);
$stmt->bind_param("ssssii", $title, $name, $data, $status, $order, $id);

if ($stmt->execute()) {
    echo json_encode(['success' => true, 'msg' => "Post #$id updated successfully!"]);
} else {
    echo json_encode(['success' => false, 'msg' => 'Update failed: ' . $conn->error]);
}
