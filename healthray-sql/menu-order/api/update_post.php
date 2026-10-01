<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    return json_encode(["Invalid request method"]);
}

require __DIR__ . '/../../conn.php';

$id = $_POST['id'];
$title = $_POST['post_title'];
$name = $_POST['post_name'];
$status = $_POST['post_status'];
$order = $_POST['menu_order'];

if (!$id) {
    echo json_encode(['success' => false, 'msg' => 'Invalid ID']);
    exit;
}

// The UI shows/edits the date as d-m-Y H:i:s (see index.php's date() call) -
// parsed explicitly against that exact format rather than strtotime(), which
// would misread a day/month-ambiguous string like "01-10-2026" on some setups.
$postDateObj = DateTime::createFromFormat('d-m-Y H:i:s', (string) ($_POST['post_date'] ?? ''));
if (!$postDateObj) {
    echo json_encode(['success' => false, 'msg' => 'Invalid date format']);
    exit;
}
$date = $postDateObj->format('Y-m-d H:i:s');

$query = "UPDATE wp_posts
          SET post_title = ?, post_name = ?, post_date = ?, post_status = ?,
          menu_order = ? WHERE ID = ?";
$stmt = $conn->prepare($query);
$stmt->bind_param("ssssii", $title, $name, $date, $status, $order, $id);

if ($stmt->execute()) {
    echo json_encode(['success' => true, 'msg' => "Post #$id updated successfully!"]);
} else {
    echo json_encode(['success' => false, 'msg' => 'Update failed: ' . $conn->error]);
}
