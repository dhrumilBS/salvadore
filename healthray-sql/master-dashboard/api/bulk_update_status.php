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
$stmt = $conn->prepare("UPDATE wp_posts SET post_status = ? WHERE ID IN ($ph)");
$types = 's' . str_repeat('i', count($ids));
$stmt->bind_param($types, $status, ...$ids);
$ok = $stmt->execute();

$ok
    ? json_out(true, 'Updated', ['updated' => $stmt->affected_rows, 'ids' => $ids, 'status' => $status])
    : json_out(false, 'Update failed: ' . $conn->error);
