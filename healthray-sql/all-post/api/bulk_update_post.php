<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

/*
 * Accepts a "posts" field containing a JSON array of objects:
 *   [{ id, post_title, post_name, post_status, menu_order, post_date }, ...]
 * Every row is updated inside a single transaction - if any row fails the
 * whole batch is rolled back so the table is never left half-saved.
 */
$posts = json_decode($_POST['posts'] ?? '', true);
if (!is_array($posts) || !count($posts)) {
    json_out(false, 'No rows submitted');
}

$stmt = $conn->prepare(
    "UPDATE wp_posts SET post_title = ?, post_name = ?, post_status = ?, menu_order = ?, post_date = ?, post_date_gmt = ? WHERE ID = ?"
);
if (!$stmt) {
    json_out(false, 'Prepare failed: ' . $conn->error);
}

$conn->begin_transaction();
$updated = 0;
$errors  = [];

foreach ($posts as $p) {
    $id = (int) ($p['id'] ?? 0);
    if ($id <= 0) {
        $errors[] = 'A row had an invalid ID';
        continue;
    }

    $ts = ($p['post_date'] ?? '') !== '' ? strtotime($p['post_date']) : false;
    if ($ts === false) {
        $errors[] = "Post #$id has an invalid date";
        continue;
    }

    $title  = $p['post_title']  ?? '';
    $name   = $p['post_name']   ?? '';
    $status = $p['post_status'] ?? 'publish';
    $order  = (int) ($p['menu_order'] ?? 0);
    $local  = date('Y-m-d H:i:s', $ts);
    $gmt    = gmdate('Y-m-d H:i:s', $ts);

    $stmt->bind_param('sssissi', $title, $name, $status, $order, $local, $gmt, $id);

    if ($stmt->execute()) {
        $updated++;
    } else {
        $errors[] = "Post #$id: " . $stmt->error;
    }
}

if ($errors) {
    $conn->rollback();
    json_out(false, 'Batch rolled back - ' . implode('; ', $errors), ['updated' => 0]);
}

$conn->commit();
json_out(true, "$updated post(s) updated successfully!", ['updated' => $updated]);
