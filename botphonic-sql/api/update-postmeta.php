<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    return json_encode(["Invalid request method"]);
}

require './../conn.php';
$post_id   = intval($_POST['id']);
$canonical = trim($_POST['canonical']);

if (!$post_id || !$canonical) {
    echo json_encode(['success' => false, 'msg' => 'Invalid canonical URL']);
    exit;
}
$meta_key = '_yoast_wpseo_canonical';
$check = $conn->prepare("
    SELECT meta_id 
    FROM wp_postmeta 
    WHERE post_id = ? AND meta_key = ?
");
$check->bind_param("is", $post_id, $meta_key);
$check->execute();
$result = $check->get_result();

if ($result->num_rows > 0) {
    $stmt = $conn->prepare("
        UPDATE wp_postmeta 
        SET meta_value = ? 
        WHERE post_id = ? AND meta_key = ?
    ");
    $stmt->bind_param("sis", $canonical, $post_id, $meta_key);
} else {
    $stmt = $conn->prepare("
        INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
        VALUES (?, ?, ?)
    ");
    $stmt->bind_param("iss", $post_id, $meta_key, $canonical);
}
if ($stmt->execute()) {
    echo json_encode([
        'success' => true,
        'msg' => "Yoast canonical updated for post #$post_id"
    ]);
} else {
    echo json_encode([
        'success' => false,
        'msg' => 'Update failed: ' . $conn->error
    ]);
}
