<?php
/**
 * POST api/canonical_fix.php - remove or replace Yoast canonical URLs (`_yoast_wpseo_canonical`).
 *
 * POST items=<JSON [{post_id, expected, canonical}]> (max 1000)
 *   expected  = the canonical the client loaded (optimistic check, compared trimmed)
 *   canonical = new value; '' removes the canonical (the post falls back to its own URL,
 *               which is what Yoast does when the field is cleared)
 *
 * All-or-nothing: one transaction with every post locked. If any post is gone or
 * its stored canonical no longer equals `expected`, nothing is written (409 +
 * per-row errors). Keeps Yoast's indexable (`wp_yoast_indexable.canonical`) in
 * step when that column exists. post_modified is not bumped (SEO meta only, like
 * Find & Replace). Logged to History as source "canonical" (undo restores the old value).
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/canonical.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

const CN_MAX_ITEMS = 1000;

$items = json_decode((string) ($_POST['items'] ?? ''), true);
if (!is_array($items) || !$items || array_keys($items) !== range(0, count($items) - 1)) {
    json_out(false, 'No canonical changes were sent.');
}
if (count($items) > CN_MAX_ITEMS) {
    json_out(false, 'At most ' . CN_MAX_ITEMS . ' canonicals per save.');
}

$errors  = [];
$planned = [];
foreach ($items as $i => $it) {
    $id = is_array($it) ? (int) ($it['post_id'] ?? 0) : 0;
    if ($id <= 0 || !is_scalar($it['expected'] ?? null) || !is_scalar($it['canonical'] ?? '')) {
        $errors[] = ['post_id' => $id, 'status' => 'invalid', 'message' => 'Malformed change #' . ($i + 1)];
        continue;
    }
    if (isset($planned[$id])) {
        $errors[] = ['post_id' => $id, 'status' => 'invalid', 'message' => "Post #{$id} appears twice in this save"];
        continue;
    }
    $new = trim((string) ($it['canonical'] ?? ''));
    if ($new !== '' && (!preg_match('~^https?://[^\s/]+~i', $new) || preg_match('~\s~', $new) || strlen($new) > 2048)) {
        $errors[] = ['post_id' => $id, 'status' => 'invalid', 'message' => "Post #{$id}: a canonical must be an absolute http(s) URL"];
        continue;
    }
    $planned[$id] = ['post_id' => $id, 'new' => $new, 'expected' => trim((string) $it['expected'])];
}
if ($errors) {
    http_response_code(400);
    json_out(false, count($errors) . ' change(s) are invalid - nothing was written', ['saved' => [], 'errors' => $errors]);
}

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$key   = DW_CANONICAL_KEY;
$log   = [];
$saved = [];
try {
    $hasIndexable = (bool) $conn->query("SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_yoast_indexable' AND COLUMN_NAME = 'canonical' LIMIT 1")->fetch_row();

    $conn->begin_transaction();

    $fetchPost = $conn->prepare('SELECT ID, post_type, post_status, post_title FROM wp_posts WHERE ID = ? LIMIT 1 FOR UPDATE');
    $fetchMeta = $conn->prepare('SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? ORDER BY meta_id FOR UPDATE');
    foreach ($planned as &$p) {
        $id = $p['post_id'];
        $fetchPost->bind_param('i', $id);
        $fetchPost->execute();
        $post = $fetchPost->get_result()->fetch_assoc();
        if (!$post || in_array($post['post_type'], ['revision', 'nav_menu_item'], true) || $post['post_status'] === 'auto-draft') {
            $errors[] = ['post_id' => $id, 'status' => 'not_found', 'message' => "Post #{$id} no longer exists"];
            continue;
        }
        $fetchMeta->bind_param('is', $id, $key);
        $fetchMeta->execute();
        $values = array_column($fetchMeta->get_result()->fetch_all(MYSQLI_NUM), 0);
        // Same value the report shows (MAX over duplicate rows).
        $current = $values ? trim((string) max($values)) : '';
        if ($current !== $p['expected']) {
            $errors[] = ['post_id' => $id, 'status' => 'conflict', 'message' => "Post #{$id}: canonical was changed elsewhere since the report was loaded", 'current' => $current];
            continue;
        }
        // History "before" = the first row, which is what activity_undo.php reads back.
        $p['before'] = $values ? (string) $values[0] : null;
        $p['title']  = html_entity_decode((string) $post['post_title'], ENT_QUOTES);
    }
    unset($p);

    if ($errors) {
        $conn->rollback();
        http_response_code(409);
        json_out(false, count($errors) . ' change(s) could not be saved - nothing was written', ['saved' => [], 'errors' => $errors]);
    }

    $delAll    = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?');
    $delExtra  = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ? AND meta_value <> ?');
    $indexable = $hasIndexable
        ? $conn->prepare("UPDATE wp_yoast_indexable SET canonical = ? WHERE object_id = ? AND object_type = 'post'")
        : null;

    foreach ($planned as $p) {
        $id  = $p['post_id'];
        $new = $p['new'];
        if ($new === $p['expected']) {
            continue; // no-op
        }
        if ($new === '') {
            $delAll->bind_param('is', $id, $key);
            $delAll->execute();
        } else {
            if (!dw_upsert_postmeta($conn, $id, $key, $new)) {
                throw new RuntimeException("upsert failed for post {$id}");
            }
            $delExtra->bind_param('iss', $id, $key, $new); // stray duplicates would keep the old value showing
            $delExtra->execute();
        }
        if ($indexable) {
            $idxVal = $new === '' ? null : $new;
            $indexable->bind_param('si', $idxVal, $id);
            $indexable->execute();
        }
        $saved[] = ['post_id' => $id, 'canonical' => $new, 'title' => $p['title']];
        $log[]   = ['kind' => 'meta', 'post_id' => $id, 'key' => $key, 'before' => $p['before'], 'after' => $new === '' ? null : $new];
    }

    $conn->commit();
} catch (Throwable $e) {
    try { $conn->rollback(); } catch (Throwable $ignored) { /* no open transaction */ }
    error_log('[master-dashboard canonical_fix ' . $ACTIVE_DB . '] ' . $e->getMessage());
    http_response_code(500);
    json_out(false, 'Save failed because of a database error - nothing was written.', ['saved' => [], 'errors' => []]);
}

$n = count($saved);
$extra = ['saved' => $saved, 'errors' => []];
if ($n) {
    $removed = count(array_filter($saved, fn($s) => $s['canonical'] === ''));
    $parts = [];
    if ($removed) {
        $parts[] = $removed . ' removed';
    }
    if ($n - $removed) {
        $parts[] = ($n - $removed) . ' replaced';
    }
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'   => 'canonical',
        'action'   => $removed === $n ? 'canonical_remove' : ($removed ? 'canonical_fix' : 'canonical_replace'),
        'summary'  => $n === 1
            ? ($saved[0]['canonical'] === '' ? 'Removed canonical' : 'Replaced canonical') . ' on #' . $saved[0]['post_id'] . ' "' . md_activity_short($saved[0]['title'], 60) . '"'
            : 'Canonicals: ' . implode(', ', $parts),
        'post_ids' => array_column($saved, 'post_id'),
        'changes'  => $log,
    ]);
    if ($activityId) {
        $extra['activity_id'] = $activityId;
    }
}

json_out(true, $n ? ($n . ' canonical' . ($n === 1 ? '' : 's') . ' updated') : 'Nothing to change', $extra);
