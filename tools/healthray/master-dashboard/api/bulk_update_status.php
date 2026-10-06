<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

/*
 * One status value applied to many posts at once - the write side of the
 * Bulk URL Update tab. Same validated status list as update_post.php's
 * single-field 'status' case, just batched into one UPDATE ... IN (...).
 */

$idsRaw = (string) ($_POST['ids'] ?? '');
$status = trim((string) ($_POST['status'] ?? ''));

$validStatuses = dw_writable_statuses();
if (!in_array($status, $validStatuses, true)) {
    json_out(false, 'Invalid status');
}

$ids = array_values(array_unique(array_filter(
    array_map('intval', explode(',', $idsRaw)),
    fn($id) => $id > 0
)));
if (!$ids) {
    json_out(false, 'No valid post IDs supplied');
}

$ph = implode(',', array_fill(0, count($ids), '?'));

$conn->begin_transaction();

// Which of these are about to move *into* trash, read under the same lock as
// the write - so the "add a 410?" prompt is offered for exactly those, even
// if the client's copy of a post's status is out of date.
$newlyTrashed = [];
if ($status === 'trash') {
    $stmt = $conn->prepare("SELECT ID FROM wp_posts WHERE ID IN ($ph) AND post_status <> 'trash' FOR UPDATE");
    $stmt->bind_param(str_repeat('i', count($ids)), ...$ids);
    $stmt->execute();
    $newlyTrashed = array_map('intval', array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), 'ID'));
}

$stmt = $conn->prepare("UPDATE wp_posts SET post_status = ? WHERE ID IN ($ph)");
$stmt->bind_param('s' . str_repeat('i', count($ids)), $status, ...$ids);
if (!$stmt->execute()) {
    $err = $conn->error;
    $conn->rollback();
    json_out(false, 'Update failed: ' . $err);
}
$updated = $stmt->affected_rows;
$conn->commit();

json_out(true, 'Updated', [
    'updated'       => $updated,
    'ids'           => $ids,
    'status'        => $status,
    'newly_trashed' => $newlyTrashed,
]);
