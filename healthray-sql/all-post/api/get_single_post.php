<?php
header('Content-Type: application/json');

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$id = isset($_POST['id']) ? (int) $_POST['id'] : 0;

if ($id <= 0) {
    echo json_encode(['success' => false, 'msg' => 'Invalid ID']);
    exit;
}

$stmt = $conn->prepare(
    "SELECT id, post_name, post_title, menu_order, post_status, post_date
     FROM wp_posts
     WHERE id = ?"
);
$stmt->bind_param('i', $id);
$stmt->execute();
$res  = $stmt->get_result();
$data = $res->fetch_assoc();

if (!$data) {
    echo json_encode(['success' => false, 'msg' => 'Post not found']);
    exit;
}

echo json_encode([
    'success'     => true,
    'msg'         => 'Row fetched',
    'id'          => $data['id'],
    'post_name'   => $data['post_name'],
    'post_title'  => $data['post_title'],
    'post_status' => $data['post_status'],
    'menu_order'  => $data['menu_order'],
    'post_date'   => date('d-m-Y H:i:s', strtotime($data['post_date'])),
]);
