<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'msg' => 'Invalid request method']);
    exit;
}

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

/*
 * Accepts a "posts" field containing a JSON array of objects:
 *   [{ id, post_title, post_name, post_status, menu_order, post_date }, ...]
 * Every row is updated inside a single transaction — if any row fails the
 * whole batch is rolled back so the table is never left half-saved.
 */
$raw   = $_POST['posts'] ?? '';
$posts = json_decode($raw, true);

if (!is_array($posts) || count($posts) === 0) {
    echo json_encode(['success' => false, 'msg' => 'No rows submitted']);
    exit;
}

$query = "UPDATE wp_posts
          SET post_title = ?, post_name = ?, post_status = ?, menu_order = ?, post_date = ?, post_date_gmt = ?
          WHERE ID = ?";

$stmt = $conn->prepare($query);
if (!$stmt) {
    echo json_encode(['success' => false, 'msg' => 'Prepare failed: ' . $conn->error]);
    exit;
}

$conn->begin_transaction();
$updated = 0;
$errors  = [];

foreach ($posts as $p) {
    $id     = isset($p['id']) ? (int) $p['id'] : 0;
    if ($id <= 0) {
        $errors[] = 'A row had an invalid ID';
        continue;
    }

    $title  = $p['post_title']  ?? '';
    $name   = $p['post_name']   ?? '';
    $status = $p['post_status'] ?? 'publish';
    $order  = isset($p['menu_order']) ? (int) $p['menu_order'] : 0;
    $date   = $p['post_date']   ?? '';

    $ts = $date !== '' ? strtotime($date) : false;
    if ($ts === false) {
        $errors[] = "Post #$id has an invalid date";
        continue;
    }
    $local = date('Y-m-d H:i:s', $ts);
    $gmt   = gmdate('Y-m-d H:i:s', $ts);

    $stmt->bind_param('sssissi', $title, $name, $status, $order, $local, $gmt, $id);

    if ($stmt->execute()) {
        $updated++;
    } else {
        $errors[] = "Post #$id: " . $stmt->error;
    }
}

if (count($errors) > 0) {
    $conn->rollback();
    echo json_encode([
        'success' => false,
        'msg'     => "Batch rolled back — " . implode('; ', $errors),
        'updated' => 0,
    ]);
    exit;
}

$conn->commit();
echo json_encode([
    'success' => true,
    'msg'     => "$updated post(s) updated successfully!",
    'updated' => $updated,
]);
