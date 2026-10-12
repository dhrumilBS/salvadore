<?php
/**
 * POST api/replace_apply.php?db= - replace in the chosen fields. Every value is
 * re-read (FOR UPDATE) and re-matched here, never trusted from the page,
 * written in one transaction, and journaled with its previous value so it can
 * be undone.
 * JSON body: {...search options, targets: [{kind: 'post'|'meta', id, field}]}
 *
 * Journal order (so a committed change can never be missing from History):
 *   1. replace-op-<id>.json (before/after of every field)   } both before the
 *   2. replace-history-<site>.jsonl gets the 'replace' line } commit - if either
 *      fails, the transaction is rolled back and nothing changes
 *   3. commit - if the commit itself fails, an 'aborted' line is appended and
 *      the op file removed, so History never lists a replace that didn't happen
 *      (and even if that fails, Undo only restores fields still equal to 'after').
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

$body = fr_body();
$o = fr_options($body);
if ($o['find'] === $o['replace']) {
    json_out(false, 'Find and Replace are the same - nothing to change.');
}
$rawTargets = is_array($body['targets'] ?? null) ? array_values($body['targets']) : [];
if (!$rawTargets) {
    json_out(false, 'Select at least one field to replace.');
}
if (count($rawTargets) > FR_MAX_FIELDS) {
    json_out(false, 'At most ' . FR_MAX_FIELDS . ' fields can be replaced at once.');
}

$changes = [];
$skipped = [];
$matches = 0;
$seen = [];
$opId = date('Ymd-His') . '-' . bin2hex(random_bytes(3));
$opFile = fr_journal_file($opId);
$opWritten = false;
$indexWritten = false;

$conn->begin_transaction();
try {
    foreach ($rawTargets as $t) {
        $t = is_array($t) ? $t : [];
        $id = (int) ($t['id'] ?? 0);
        $field = is_string($t['field'] ?? null) ? $t['field'] : '';
        $kind = is_string($t['kind'] ?? null) ? $t['kind'] : '';

        // Invalid targets are reported, never silently dropped.
        if ($id <= 0 || !in_array($kind, ['post', 'meta'], true) || $field === '' || ($kind === 'post' && !in_array($field, FR_POST_COLS, true))) {
            $skipped[] = ['id' => $id, 'kind' => $kind, 'field' => $field, 'reason' => 'Not a field this tool can replace in.'];
            continue;
        }
        if ($kind === 'meta' && in_array($field, FR_SKIP_META, true)) {
            $skipped[] = ['id' => $id, 'kind' => $kind, 'field' => $field, 'reason' => 'Protected field (cache / file path / editor lock).'];
            continue;
        }
        // The same field listed twice would be replaced twice (e.g. "a" -> "ab").
        $k = "$kind:$id";
        if (isset($seen[$k])) {
            $skipped[] = ['id' => $id, 'kind' => $kind, 'field' => $field, 'reason' => 'Listed twice - replaced once.'];
            continue;
        }
        $seen[$k] = true;

        if ($kind === 'post') {
            $row = fr_run($conn, "SELECT ID AS post_id, post_type, $field AS v FROM wp_posts WHERE ID = ? FOR UPDATE", [$id])[0] ?? null;
        } else {
            $row = fr_run($conn, 'SELECT m.post_id, m.meta_key, p.post_type, m.meta_value AS v FROM wp_postmeta m JOIN wp_posts p ON p.ID = m.post_id WHERE m.meta_id = ? FOR UPDATE', [$id])[0] ?? null;
            if ($row && $row['meta_key'] !== $field) {
                $row = null;
            }
        }
        if (!$row || in_array($row['post_type'], FR_SKIP_TYPES, true)) {
            $skipped[] = ['id' => $id, 'kind' => $kind, 'field' => $field, 'reason' => 'No longer exists.'];
            continue;
        }
        $res = fr_apply((string) $row['v'], $o);
        if ($res['blocked']) {
            $skipped[] = ['id' => $id, 'kind' => $kind, 'post_id' => (int) $row['post_id'], 'field' => $field, 'reason' => $res['blocked']];
            continue;
        }
        if (!$res['count'] || $res['value'] === $row['v']) {
            $skipped[] = ['id' => $id, 'kind' => $kind, 'post_id' => (int) $row['post_id'], 'field' => $field, 'reason' => 'No match any more.'];
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

    if (!$changes) {
        $conn->rollback();
        json_out(false, 'Nothing was changed.', ['skipped' => $skipped]);
    }

    $postCount = count(array_unique(array_column($changes, 'post_id')));
    $elementor = in_array('_elementor_data', array_column($changes, 'field'), true);

    // 1. Backup before committing: if it can't be written, nothing is changed.
    if (!fr_ensure_backup_dir()) {
        throw new RuntimeException('Could not create the backups folder, so nothing was changed.');
    }
    $json = json_encode(['id' => $opId, 'site' => $ACTIVE_DB, 'changes' => $changes], JSON_UNESCAPED_UNICODE);
    if ($json === false || !@file_put_contents($opFile, $json, LOCK_EX)) {
        throw new RuntimeException('Could not write the undo backup, so nothing was changed.');
    }
    $opWritten = true;

    // 2. History index line, also before the commit.
    $indexWritten = fr_journal_append($ACTIVE_DB, [
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
    if (!$indexWritten) {
        throw new RuntimeException('Could not write the replace history, so nothing was changed.');
    }

    // 3. Commit.
    $conn->commit();
} catch (Throwable $e) {
    try {
        $conn->rollback();
    } catch (Throwable $ignored) {
    }
    if ($indexWritten) {
        fr_journal_append($ACTIVE_DB, ['event' => 'aborted', 'id' => $opId, 'time' => date('c')]);
    }
    if ($opWritten) {
        @unlink($opFile);
    }
    json_out(false, $e->getMessage());
}

// Activity history: points at this op (its own journal holds the full before/after + undo).
$activityId = md_activity_log($ACTIVE_DB, [
    'source'  => 'replace',
    'action'  => 'replace',
    'summary' => 'Find & Replace: "' . md_activity_short($o['find'], 50) . '" → "' . md_activity_short($o['replace'], 50) . "\" - $matches "
        . ($matches === 1 ? 'match' : 'matches') . ' in ' . count($changes) . ' field' . (count($changes) === 1 ? '' : 's') . " across $postCount post" . ($postCount === 1 ? '' : 's'),
    'changes' => array_map(fn($c) => [
        'kind' => 'text', 'post_id' => $c['post_id'], 'field' => $c['field'], 'target' => $c['kind'], 'count' => $c['count'],
        'before' => $o['find'], 'after' => $o['replace'],
    ], $changes),
    'ref'     => ['journal' => 'replace', 'id' => $opId],
]);

json_out(true, "Replaced $matches " . ($matches === 1 ? 'match' : 'matches') . ' in ' . count($changes) . ' ' . (count($changes) === 1 ? 'field' : 'fields') . '.', [
    'op'        => $opId,
    'fields'    => count($changes),
    'posts'     => $postCount,
    'matches'   => $matches,
    'changed'   => array_map(fn($c) => ['kind' => $c['kind'], 'id' => $c['id']], $changes),
    'skipped'   => $skipped,
    'elementor' => $elementor,
] + ($activityId ? ['activity_id' => $activityId] : []));
