<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

/*
 * Accepts a "posts" field containing a JSON array of objects:
 *   [{ id, post_title, post_name, post_status }, ...]
 * Every row is updated inside a single transaction - if any row fails the
 * whole batch is rolled back so the table is never left half-saved.
 */
$posts = json_decode($_POST['posts'] ?? '', true);
if (!is_array($posts) || !count($posts)) {
    json_out(false, 'No rows submitted');
}

$stmt = $conn->prepare('UPDATE wp_posts SET post_title = ?, post_name = ?, post_status = ? WHERE ID = ?');
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

    $title  = $p['post_title']  ?? '';
    $name   = $p['post_name']   ?? '';
    $status = $p['post_status'] ?? 'publish';

    $stmt->bind_param('sssi', $title, $name, $status, $id);

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
