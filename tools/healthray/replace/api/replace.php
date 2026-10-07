<?php
/**
 * POST api/replace.php - replace in the chosen fields. Every value is re-read
 * and re-matched here (never trusted from the page), written in one
 * transaction, and journaled with its previous value so it can be undone.
 * Body: {db, ...search options, targets: [{kind: 'post'|'meta', id, field}]}
 */
require __DIR__ . '/lib.php';
require_write_request();

$body = fr_body();
$o = fr_options($body);
if ($o['find'] === $o['replace']) {
    json_out(false, 'Find and Replace are the same - nothing to change.');
}
$targets = array_slice((array) ($body['targets'] ?? []), 0, FR_MAX_FIELDS);
if (!$targets) {
    json_out(false, 'Select at least one field to replace.');
}

$postCols = ['post_title', 'post_content', 'post_excerpt'];
$changes = [];
$skipped = [];
$matches = 0;
$opId = date('Ymd-His') . '-' . bin2hex(random_bytes(3));

$conn->begin_transaction();
try {
    foreach ($targets as $t) {
        $id = (int) ($t['id'] ?? 0);
        $field = (string) ($t['field'] ?? '');
        $kind = (string) ($t['kind'] ?? '');
        if ($kind === 'post' && in_array($field, $postCols, true)) {
            $row = fr_run($conn, "SELECT ID AS post_id, post_type, $field AS v FROM wp_posts WHERE ID = ? FOR UPDATE", [$id])[0] ?? null;
        } elseif ($kind === 'meta' && !in_array($field, FR_SKIP_META, true)) {
            $row = fr_run($conn, 'SELECT m.post_id, m.meta_key, p.post_type, m.meta_value AS v FROM wp_postmeta m JOIN wp_posts p ON p.ID = m.post_id WHERE m.meta_id = ? FOR UPDATE', [$id])[0] ?? null;
            if ($row && $row['meta_key'] !== $field) {
                $row = null;
            }
        } else {
            continue;
        }
        if (!$row || in_array($row['post_type'], FR_SKIP_TYPES, true)) {
            $skipped[] = ['id' => $id, 'field' => $field, 'reason' => 'No longer exists.'];
            continue;
        }
        $res = fr_apply((string) $row['v'], $o);
        if ($res['blocked']) {
            $skipped[] = ['id' => $id, 'post_id' => (int) $row['post_id'], 'field' => $field, 'reason' => $res['blocked']];
            continue;
        }
        if (!$res['count'] || $res['value'] === $row['v']) {
            $skipped[] = ['id' => $id, 'post_id' => (int) $row['post_id'], 'field' => $field, 'reason' => 'No match any more.'];
            continue;
        }
        $stmt = $kind === 'post'
            ? $conn->prepare("UPDATE wp_posts SET $field = ? WHERE ID = ?")
            : $conn->prepare('UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?');
        $stmt->bind_param('si', $res['value'], $id);
        $stmt->execute();
        $matches += $res['count'];
        $changes[] = ['kind' => $kind, 'id' => $id, 'post_id' => (int) $row['post_id'], 'field' => $field, 'count' => $res['count'], 'before' => $row['v'], 'after' => $res['value']];
    }

    if ($changes) {
        // Back up before committing: if the backup can't be written, nothing is changed.
        if (!is_dir(FR_BACKUP_DIR)) {
            mkdir(FR_BACKUP_DIR, 0775, true);
        }
        $json = json_encode(['id' => $opId, 'site' => $ACTIVE_DB, 'changes' => $changes], JSON_UNESCAPED_UNICODE);
        if ($json === false || !file_put_contents(fr_journal_file($opId), $json, LOCK_EX)) {
            throw new RuntimeException('Could not write the undo backup, so nothing was changed.');
        }
    }
    $conn->commit();
} catch (Throwable $e) {
    $conn->rollback();
    json_out(false, $e->getMessage());
}

if (!$changes) {
    json_out(false, 'Nothing was changed.', ['skipped' => $skipped]);
}

$postCount = count(array_unique(array_column($changes, 'post_id')));
$elementor = in_array('_elementor_data', array_column($changes, 'field'), true);
fr_journal_append($ACTIVE_DB, [
    'event'     => 'replace',
    'id'        => $opId,
    'time'      => date('c'),
    'find'      => $o['find'],
    'replace'   => $o['replace'],
    'options'   => ['case' => $o['case'], 'word' => $o['word'], 'skipTags' => $o['skipTags']],
    'fields'    => count($changes),
    'posts'     => $postCount,
    'matches'   => $matches,
    'elementor' => $elementor,
    'ip'        => $_SERVER['REMOTE_ADDR'] ?? '',
]);

json_out(true, "Replaced $matches " . ($matches === 1 ? 'match' : 'matches') . ' in ' . count($changes) . ' ' . (count($changes) === 1 ? 'field' : 'fields') . '.', [
    'op'        => $opId,
    'fields'    => count($changes),
    'posts'     => $postCount,
    'matches'   => $matches,
    'changed'   => array_map(fn($c) => ['kind' => $c['kind'], 'id' => $c['id']], $changes),
    'skipped'   => $skipped,
    'elementor' => $elementor,
]);
