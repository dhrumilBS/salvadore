<?php
/**
 * POST api/undo.php - restore the values a replace operation changed.
 * A field edited again since then (its value is no longer what we wrote) is
 * left alone and reported, so an undo never overwrites newer work.
 * Body: {db, id}
 */
require __DIR__ . '/lib.php';
require_write_request();

$id = (string) (fr_body()['id'] ?? '');
$op = null;
foreach (fr_journal_list($ACTIVE_DB) as $e) {
    if ($e['id'] === $id) {
        $op = $e;
    }
}
$file = fr_journal_file($id);
if (!$op || !is_file($file)) {
    json_out(false, 'That operation was not found for this site.');
}
if (!empty($op['undone'])) {
    json_out(false, 'Already undone.');
}
$data = json_decode(file_get_contents($file), true);
if (!is_array($data) || ($data['site'] ?? '') !== $ACTIVE_DB) {
    json_out(false, 'The backup for this operation is unreadable.');
}

$restored = 0;
$skipped = [];
$conn->begin_transaction();
try {
    foreach ($data['changes'] as $c) {
        if ($c['kind'] === 'post' && in_array($c['field'], ['post_title', 'post_content', 'post_excerpt'], true)) {
            $cur = fr_run($conn, "SELECT {$c['field']} AS v FROM wp_posts WHERE ID = ? FOR UPDATE", [$c['id']])[0]['v'] ?? null;
            $sql = "UPDATE wp_posts SET {$c['field']} = ? WHERE ID = ?";
        } elseif ($c['kind'] === 'meta') {
            $cur = fr_run($conn, 'SELECT meta_value AS v FROM wp_postmeta WHERE meta_id = ? FOR UPDATE', [$c['id']])[0]['v'] ?? null;
            $sql = 'UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?';
        } else {
            continue;
        }
        if ($cur === null || $cur !== $c['after']) {
            $skipped[] = ['post_id' => $c['post_id'], 'field' => $c['field'], 'reason' => $cur === null ? 'Deleted since.' : 'Edited again since - left as is.'];
            continue;
        }
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('si', $c['before'], $c['id']);
        $stmt->execute();
        $restored++;
    }
    $conn->commit();
} catch (Throwable $e) {
    $conn->rollback();
    json_out(false, $e->getMessage());
}

fr_journal_append($ACTIVE_DB, ['event' => 'undo', 'id' => $id, 'time' => date('c'), 'restored' => $restored, 'skipped' => count($skipped)]);
json_out(true, "Restored $restored " . ($restored === 1 ? 'field' : 'fields') . ($skipped ? ', ' . count($skipped) . ' skipped (edited again since)' : '') . '.', ['restored' => $restored, 'skipped' => $skipped]);
