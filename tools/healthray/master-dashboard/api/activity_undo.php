<?php
/**
 * POST api/activity_undo.php?db= - undo one unified-History entry. Body: id
 *
 *  - post / meta / redirect changes: each change is put back to its `before`
 *    value ONLY while the current value still equals the logged `after`
 *    (otherwise skipped, with the reason). Post + meta restores run in one
 *    transaction with the rows locked; redirect restores go through
 *    dw_redirect_restore() (backup first, base + export options, own
 *    transaction). Menu Order undos bump post_modified like menu_save.php
 *    does; Content/Bulk undos don't (neither do those endpoints). Status
 *    changes into/out of trash never add or remove a 410 - the result says so.
 *  - Find & Replace entries delegate to fr_undo_op(), Link Fixer entries to
 *    dw_fx_undo() (their journals keep the full previous values).
 *  - "fx-<id>" / "fr-<id>" are journal lines merged in by activity_list.php.
 *
 * On success a new 'undo' entry is logged (undo_of = the original) and, for
 * post/meta/redirect entries, the original gets an 'undone' marker.
 * Response: {success, msg, restored, skipped: [{post_id?, field, reason}], notes, refresh: [posts|links|redirects], activity_id}
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';
require __DIR__ . '/lib/redirect_store.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

const MD_UNDO_POST_COLS = ['post_title', 'post_name', 'post_status', 'post_date', 'post_date_gmt', 'post_modified', 'post_modified_gmt', 'menu_order'];

$id = (string) ($_POST['id'] ?? '');
if ($id === '' || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) {
    json_out(false, 'Invalid entry id');
}

$entry = null;
if (str_starts_with($id, 'fx-')) {
    $entry = ['id' => $id, 'source' => 'fixer', 'action' => 'journal', 'migrated' => true, 'ref' => ['journal' => 'fixer', 'ids' => [substr($id, 3)]]];
} elseif (str_starts_with($id, 'fr-')) {
    $entry = ['id' => $id, 'source' => 'replace', 'action' => 'replace', 'migrated' => true, 'ref' => ['journal' => 'replace', 'id' => substr($id, 3)]];
} else {
    $entry = md_activity_find($ACTIVE_DB, $id);
}
if (!$entry) {
    json_out(false, 'That history entry was not found for this site.');
}
if (($entry['action'] ?? '') === 'undo' && empty($entry['ref'])) {
    json_out(false, 'An undo cannot itself be undone here - make the change again instead.');
}
if (!empty($entry['undone'])) {
    json_out(false, 'Already undone.');
}
$origin = empty($entry['migrated']) ? $id : null; // activity id the undo entry points back at
$ref = is_array($entry['ref'] ?? null) ? $entry['ref'] : null;

/* ══════════ Find & Replace: delegate ══════════ */
if ($ref && ($ref['journal'] ?? '') === 'replace') {
    $opId = (string) ($ref['id'] ?? '');
    $r = fr_undo_op($conn, $ACTIVE_DB, $opId);
    if (!$r['success']) {
        json_out(false, $r['msg']);
    }
    $op = $r['op'];
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'replace',
        'action'  => 'undo',
        'summary' => 'Undid Find & Replace "' . md_activity_short($op['find'] ?? '', 50) . '" → "' . md_activity_short($op['replace'] ?? '', 50) . "\": restored {$r['restored']} field" . ($r['restored'] === 1 ? '' : 's')
            . ($r['skipped'] ? ', ' . count($r['skipped']) . ' skipped' : ''),
        'ref'     => ['journal' => 'replace', 'id' => $opId],
        'undo_of' => $origin,
        'skipped' => $r['skipped'],
    ]);
    json_out(true, $r['msg'], ['restored' => $r['restored'], 'skipped' => $r['skipped'], 'notes' => [], 'refresh' => ['links'], 'activity_id' => $activityId]);
}

/* ══════════ Link Fixer: delegate, one journal entry at a time ══════════ */
if ($ref && ($ref['journal'] ?? '') === 'fixer') {
    $ids = array_values(array_filter(array_map('strval', (array) ($ref['ids'] ?? [$ref['id'] ?? ''])), fn($j) => preg_match('/^[a-f0-9]{16}$/', $j)));
    if (!$ids) {
        json_out(false, 'This entry has no Link Fixer changes to undo.');
    }
    $restored = 0;
    $skipped = [];
    $newIds = [];
    $changes = [];
    foreach ($ids as $jid) {
        $r = dw_fx_undo($conn, $ACTIVE_DB, $jid);
        if ($r['status'] === 'undone') {
            $restored++;
            $newIds[] = $r['journal_id'];
            $t = $r['undone'];
            $changes[] = ['kind' => 'link', 'post_id' => (int) $t['post_id'], 'field' => $t['source'] === 'faq' ? (string) $t['meta_key'] : 'post_content', 'before' => (string) $t['to'], 'after' => (string) $t['from']];
        } else {
            $skipped[] = ['journal_id' => $jid, 'field' => 'link', 'reason' => $r['message'] ?? $r['status']];
        }
    }
    if (!$restored) {
        json_out(false, $skipped[0]['reason'] ?? 'Nothing could be undone.', ['restored' => 0, 'skipped' => $skipped]);
    }
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'fixer',
        'action'  => 'undo',
        'summary' => 'Undid ' . $restored . ' Link Fixer change' . ($restored === 1 ? '' : 's')
            . ($restored === 1 ? ' on #' . $changes[0]['post_id'] . ': ' . md_activity_short($changes[0]['before'] ?: '(unlinked)', 60) . ' → ' . md_activity_short($changes[0]['after'], 60) : '')
            . ($skipped ? ', ' . count($skipped) . ' skipped' : ''),
        'changes' => $changes,
        'ref'     => ['journal' => 'fixer', 'ids' => $newIds, 'undo_of' => $ids],
        'undo_of' => $origin,
        'skipped' => $skipped,
    ]);
    $msg = "Undid $restored link change" . ($restored === 1 ? '' : 's') . ($skipped ? ', ' . count($skipped) . ' skipped (changed since)' : '') . '.';
    json_out(true, $msg, ['restored' => $restored, 'skipped' => $skipped, 'notes' => [], 'refresh' => ['links'], 'activity_id' => $activityId]);
}

/* ══════════ post / meta / redirect changes ══════════ */
$changes = array_values(array_filter($entry['changes'] ?? [], 'is_array'));
$restoredChanges = [];
$skipped = [];
$notes = [];
$refresh = [];
$isMenu = ($entry['source'] ?? '') === 'menu';
$str = fn($v) => $v === null ? null : (string) $v;

$dbChanges = array_values(array_filter($changes, fn($c) => in_array($c['kind'] ?? '', ['post', 'meta'], true)));
if ($dbChanges) {
    $conn->begin_transaction();
    try {
        $postSets = []; // post_id => [col => value]
        $bumpIds = [];  // post ids whose post_modified a restore bumps outside $postSets
        $hasIndexableKw = null;
        foreach ($dbChanges as $c) {
            $pid = (int) ($c['post_id'] ?? 0);
            if ($c['kind'] === 'post') {
                $col = (string) ($c['field'] ?? '');
                if ($pid <= 0 || !in_array($col, MD_UNDO_POST_COLS, true)) {
                    $skipped[] = ['post_id' => $pid, 'field' => $col, 'reason' => 'Not a field History can restore.'];
                    continue;
                }
                $stmt = $conn->prepare("SELECT ID, post_type, post_parent, $col AS v FROM wp_posts WHERE ID = ? FOR UPDATE");
                $stmt->bind_param('i', $pid);
                $stmt->execute();
                $row = $stmt->get_result()->fetch_assoc();
                if (!$row) {
                    $skipped[] = ['post_id' => $pid, 'field' => $col, 'reason' => 'Post no longer exists.'];
                    continue;
                }
                if ((string) $row['v'] !== (string) $c['after']) {
                    $skipped[] = ['post_id' => $pid, 'field' => $col, 'reason' => 'Changed since (now "' . md_activity_short($row['v'], 60) . '") - left as is.'];
                    continue;
                }
                $before = (string) ($c['before'] ?? '');
                if ($col === 'post_name') {
                    $stmt = $conn->prepare("SELECT ID FROM wp_posts WHERE post_name = ? AND post_type = ? AND post_parent = ? AND ID <> ?
                        AND post_status NOT IN ('trash', 'auto-draft', 'inherit') LIMIT 1");
                    $parent = (int) $row['post_parent'];
                    $stmt->bind_param('ssii', $before, $row['post_type'], $parent, $pid);
                    $stmt->execute();
                    $clash = $stmt->get_result()->fetch_assoc();
                    if ($before === '' || $clash) {
                        $skipped[] = ['post_id' => $pid, 'field' => $col, 'reason' => $clash ? "Old slug \"{$before}\" is now used by #{$clash['ID']}." : 'Old slug was empty.'];
                        continue;
                    }
                }
                if ($col === 'post_status') {
                    if (!preg_match('/^[a-z0-9_-]{1,20}$/', $before)) {
                        $skipped[] = ['post_id' => $pid, 'field' => $col, 'reason' => 'Old status is not valid.'];
                        continue;
                    }
                    if ($before === 'trash' || (string) $c['after'] === 'trash') {
                        $notes[] = "#{$pid}: status " . $c['after'] . ' → ' . $before . ' - no 410 redirect was ' . ($before === 'trash' ? 'added' : 'removed') . '; check the Redirects tab if one is needed.';
                    }
                }
                $postSets[$pid][$col] = $col === 'menu_order' ? (int) $before : $before;
                $restoredChanges[] = $c;
            } else {
                $key = (string) ($c['key'] ?? '');
                if ($pid <= 0 || $key === '') {
                    $skipped[] = ['post_id' => $pid, 'field' => $key, 'reason' => 'Malformed change.'];
                    continue;
                }
                $stmt = $conn->prepare('SELECT meta_id, meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? ORDER BY meta_id LIMIT 1 FOR UPDATE');
                $stmt->bind_param('is', $pid, $key);
                $stmt->execute();
                $row = $stmt->get_result()->fetch_assoc();
                $cur = $row ? $row['meta_value'] : null;

                // Focus keywords (kw_save.php): '' means "no meta row", values are
                // trimmed, and a save also syncs Yoast's indexable + bumps post_modified.
                if ($key === '_yoast_wpseo_focuskw') {
                    $curKw = trim((string) $cur);
                    if ($curKw !== trim((string) ($c['after'] ?? ''))) {
                        $skipped[] = ['post_id' => $pid, 'field' => $key, 'reason' => 'Changed since (now "' . md_activity_short($curKw, 60) . '") - left as is.'];
                        continue;
                    }
                    $before = trim((string) ($c['before'] ?? ''));
                    if ($before === '') {
                        $stmt = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?');
                        $stmt->bind_param('is', $pid, $key);
                        $stmt->execute();
                    } else {
                        dw_upsert_postmeta($conn, $pid, $key, $before);
                        $stmt = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ? AND meta_value <> ?');
                        $stmt->bind_param('iss', $pid, $key, $before);
                        $stmt->execute();
                    }
                    if ($hasIndexableKw ??= (bool) $conn->query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                            AND TABLE_NAME = 'wp_yoast_indexable' AND COLUMN_NAME = 'primary_focus_keyword' LIMIT 1")->fetch_row()) {
                        $idxVal = $before === '' ? null : $before;
                        $stmt = $conn->prepare("UPDATE wp_yoast_indexable SET primary_focus_keyword = ? WHERE object_id = ? AND object_type = 'post'");
                        $stmt->bind_param('si', $idxVal, $pid);
                        $stmt->execute();
                    }
                    $bumpIds[$pid] = true;
                    $restoredChanges[] = $c;
                    continue;
                }

                if ($str($cur) !== $str($c['after'] ?? null)) {
                    $skipped[] = ['post_id' => $pid, 'field' => $key, 'reason' => $cur === null ? 'Deleted since.' : 'Changed since (now "' . md_activity_short($cur, 60) . '") - left as is.'];
                    continue;
                }
                if (($c['before'] ?? null) === null) {
                    if ($row) { // it didn't exist before the write: remove it again
                        $stmt = $conn->prepare('DELETE FROM wp_postmeta WHERE meta_id = ?');
                        $stmt->bind_param('i', $row['meta_id']);
                        $stmt->execute();
                    }
                } elseif ($row) {
                    $before = (string) $c['before'];
                    $stmt = $conn->prepare('UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?');
                    $stmt->bind_param('si', $before, $row['meta_id']);
                    $stmt->execute();
                } else {
                    // logged after was null (deleted) and it's still gone: recreate it
                    $before = (string) $c['before'];
                    $stmt = $conn->prepare('INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)');
                    $stmt->bind_param('iss', $pid, $key, $before);
                    $stmt->execute();
                }
                // Canonicals (canonical_fix.php): keep Yoast's indexable in step, as the fix did.
                if ($key === '_yoast_wpseo_canonical' && ($hasIndexableCanonical ??= (bool) $conn->query("SELECT 1 FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_yoast_indexable' AND COLUMN_NAME = 'canonical' LIMIT 1")->fetch_row())) {
                    $idxVal = ($c['before'] ?? null) === null || trim((string) $c['before']) === '' ? null : (string) $c['before'];
                    $stmt = $conn->prepare("UPDATE wp_yoast_indexable SET canonical = ? WHERE object_id = ? AND object_type = 'post'");
                    $stmt->bind_param('si', $idxVal, $pid);
                    $stmt->execute();
                }
                // Robots (update_post.php): same indexable sync as the save.
                if (in_array($key, DW_ROBOTS_META, true)) {
                    dw_robots_sync_indexable($conn, $pid, $key, $c['before'] ?? null);
                }
                $restoredChanges[] = $c;
            }
        }

        // post_modified in the site's timezone - MySQL NOW() is the DB server's clock, not the site's.
        $siteNow = dw_site_now($conn);
        foreach ($postSets as $pid => $set) {
            $cols = array_keys($set);
            // A restore that names post_modified itself (a dates cleanup) puts it back; otherwise Menu undos bump it.
            $bump = $isMenu && !isset($set['post_modified']);
            $sql = 'UPDATE wp_posts SET ' . implode(', ', array_map(fn($col) => "$col = ?", $cols))
                . ($bump ? ', post_modified = ?, post_modified_gmt = UTC_TIMESTAMP()' : '') . ' WHERE ID = ?';
            $types = implode('', array_map(fn($col) => $col === 'menu_order' ? 'i' : 's', $cols)) . ($bump ? 's' : '') . 'i';
            $vals = array_merge(array_values($set), $bump ? [$siteNow] : [], [$pid]);
            $stmt = $conn->prepare($sql); // columns come from MD_UNDO_POST_COLS only
            $stmt->bind_param($types, ...$vals);
            $stmt->execute();
            if (isset($set['post_date_gmt'])) {
                dw_sync_published_indexable($conn, $pid, $set['post_date_gmt']); // Yoast's copy of the publish date
            }
            if (isset($set['post_modified_gmt'])) { // and of the last-modified date (object_last_modified = post_modified_gmt)
                $ix = $conn->prepare("UPDATE wp_yoast_indexable SET object_last_modified = ? WHERE object_id = ? AND object_type = 'post'");
                $ix->bind_param('si', $set['post_modified_gmt'], $pid);
                $ix->execute();
            }
        }
        foreach (array_keys($bumpIds) as $pid) { // focus keyword restores, like kw_save.php
            $stmt = $conn->prepare('UPDATE wp_posts SET post_modified = ?, post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?');
            $stmt->bind_param('si', $siteNow, $pid);
            $stmt->execute();
        }
        $conn->commit();
    } catch (Throwable $e) {
        try { $conn->rollback(); } catch (Throwable $ignored) { }
        error_log('[master-dashboard activity_undo ' . $ACTIVE_DB . '] ' . $e->getMessage());
        json_out(false, 'Undo failed because of a database error - nothing was restored.');
    }
    if (array_filter($restoredChanges, fn($c) => $c['kind'] === 'post')) {
        $refresh[] = 'posts';
    }
    if (array_filter($restoredChanges, fn($c) => $c['kind'] === 'meta')) {
        $refresh[] = 'links';
    }
}

foreach ($changes as $c) {
    if (($c['kind'] ?? '') !== 'redirect') {
        continue;
    }
    $o = (string) ($c['origin'] ?? '');
    $r = dw_redirect_restore($conn, $o, is_array($c['after'] ?? null) ? $c['after'] : null, is_array($c['before'] ?? null) ? $c['before'] : null, $ACTIVE_DB, $c['format'] ?? 'plain');
    if ($r['status'] === 'restored') {
        $restoredChanges[] = $c;
        $refresh[] = 'redirects';
    } else {
        $skipped[] = ['field' => '/' . $o . '/', 'reason' => $r['msg']];
    }
}

if (!$restoredChanges) {
    json_out(false, $skipped ? 'Nothing restored: ' . $skipped[0]['reason'] : 'This entry has nothing History can undo.', ['restored' => 0, 'skipped' => $skipped, 'notes' => $notes]);
}

$n = count($restoredChanges);
$inverse = array_map(function ($c) {
    [$c['before'], $c['after']] = [$c['after'] ?? null, $c['before'] ?? null];
    return $c;
}, $restoredChanges);
$activityId = md_activity_log($ACTIVE_DB, [
    'source'  => $entry['source'] ?? 'content',
    'action'  => 'undo',
    'summary' => 'Undid: ' . md_activity_short($entry['summary'] ?? '', 140) . " ($n change" . ($n === 1 ? '' : 's') . ' restored' . ($skipped ? ', ' . count($skipped) . ' skipped' : '') . ')',
    'changes' => $inverse,
    'undo_of' => $id,
    'skipped' => $skipped,
]);
md_activity_mark_undone($ACTIVE_DB, $id, (string) $activityId, ['restored' => $n, 'skipped' => count($skipped)]);

json_out(true, "Restored $n change" . ($n === 1 ? '' : 's') . ($skipped ? ', ' . count($skipped) . ' skipped (changed since)' : '') . '.', [
    'restored'    => $n,
    'skipped'     => $skipped,
    'notes'       => $notes,
    'refresh'     => array_values(array_unique($refresh)),
    'activity_id' => $activityId,
]);
