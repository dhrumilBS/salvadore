<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

/*
 * Accepts a "posts" field containing a JSON array of objects:
 *   [{ id, post_title, post_name, post_status }, ...]
 * Every row is validated first, then updated inside a single transaction -
 * if any row fails the whole batch is rolled back so the table is never left
 * half-saved.
 */
$posts = json_decode($_POST['posts'] ?? '', true);
if (!is_array($posts) || !count($posts)) {
    json_out(false, 'No rows submitted');
}
if (count($posts) > 2000) {
    json_out(false, 'Too many rows in one save (max 2000)');
}

$rows = [];
$errors = [];
foreach ($posts as $p) {
    $row = tp_clean_row(is_array($p) ? $p : []);
    is_string($row) ? $errors[] = $row : $rows[] = $row;
}
if ($errors) {
    json_out(false, 'Nothing saved - ' . implode('; ', array_slice($errors, 0, 5)) . (count($errors) > 5 ? ' …' : ''), ['updated' => 0]);
}

$stmt = tp_update_stmt($conn);
$conn->begin_transaction();
$saved = [];

foreach ($rows as [$id, $title, $slug, $status]) {
    $stmt->bind_param('sssi', $title, $slug, $status, $id);
    if (!$stmt->execute()) {
        $conn->rollback();
        json_out(false, "Nothing saved - page #$id: " . $stmt->error, ['updated' => 0]);
    }
    $saved[] = ['id' => $id, 'post_title' => $title, 'post_name' => $slug, 'post_status' => $status];
}

$conn->commit();
$n = count($saved);
json_out(true, $n === 1 ? '1 page saved' : "$n pages saved", ['updated' => $n, 'rows' => $saved]);
