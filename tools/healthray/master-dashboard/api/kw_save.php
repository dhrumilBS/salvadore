<?php
/**
 * POST api/kw_save.php - Focus Keywords tab: save staged focus-keyword edits.
 *
 * JSON body: {"changes":[{"post_id":123,"focus_keyword":"new kw","expected":"old kw"}, ...]}
 *   expected = the keyword the client loaded (optimistic check, compared trimmed).
 *
 * All-or-nothing: every change is validated inside one transaction with the
 * posts locked. If any post is missing / not a real post, or its stored
 * keyword no longer equals `expected`, nothing is written and the response
 * lists per-row errors (status 'conflict' / 'invalid' / 'not_found').
 *
 * Writes `_yoast_wpseo_focuskw` (an empty keyword deletes the meta row, which
 * is what Yoast itself does when the field is cleared), keeps Yoast's
 * indexable (`primary_focus_keyword`) in step when that column exists, and
 * bumps post_modified / post_modified_gmt.
 */
require __DIR__ . '/bootstrap.php';
require_post_method();

const KW_MAX_CHANGES = 500;
const KW_MAX_LEN     = 191;
const KW_META_KEY    = '_yoast_wpseo_focuskw';

$body = json_decode((string) file_get_contents('php://input'), true);
$changes = is_array($body) ? ($body['changes'] ?? null) : null;
if (!is_array($changes) || !$changes || array_keys($changes) !== range(0, count($changes) - 1)) {
    http_response_code(400);
    json_out(false, 'No changes sent');
}
if (count($changes) > KW_MAX_CHANGES) {
    http_response_code(400);
    json_out(false, 'Too many changes in one save (max ' . KW_MAX_CHANGES . ')');
}

/** Same normalisation the list uses for display/compare. */
function kw_clean($v): string
{
    return trim(preg_replace('/\s+/u', ' ', (string) $v) ?? '');
}

// Shape validation first - no DB work for a malformed batch.
$errors  = [];
$planned = [];
$seen    = [];
foreach ($changes as $i => $c) {
    $id = is_array($c) ? (int) ($c['post_id'] ?? 0) : 0;
    if ($id <= 0 || !is_array($c) || !array_key_exists('focus_keyword', $c) || !array_key_exists('expected', $c)
        || !is_scalar($c['focus_keyword'] ?? '') || !is_scalar($c['expected'] ?? '')) {
        $errors[] = ['post_id' => $id, 'status' => 'invalid', 'message' => 'Malformed change #' . ($i + 1)];
        continue;
    }
    if (isset($seen[$id])) {
        $errors[] = ['post_id' => $id, 'status' => 'invalid', 'message' => "Post #{$id} appears twice in this save"];
        continue;
    }
    $seen[$id] = true;
    $new = kw_clean($c['focus_keyword']);
    if (mb_strlen($new) > KW_MAX_LEN) {
        $errors[] = ['post_id' => $id, 'status' => 'invalid', 'message' => 'Keyword is longer than ' . KW_MAX_LEN . ' characters'];
        continue;
    }
    $planned[] = ['post_id' => $id, 'new' => $new, 'expected' => trim((string) $c['expected'])];
}
if ($errors) {
    http_response_code(400);
    json_out(false, count($errors) . ' change(s) are invalid - nothing was written', ['saved' => [], 'errors' => $errors]);
}

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$log   = [];
$saved = [];
try {
    // Does this install's Yoast indexable table carry primary_focus_keyword? (read-only check)
    $col = $conn->query("SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_yoast_indexable' AND COLUMN_NAME = 'primary_focus_keyword' LIMIT 1");
    $hasIndexable = (bool) $col->fetch_row();

    $conn->begin_transaction();

    $fetchPost = $conn->prepare('SELECT ID, post_type, post_status, post_title FROM wp_posts WHERE ID = ? LIMIT 1 FOR UPDATE');
    $fetchMeta = $conn->prepare('SELECT MAX(meta_value) FROM wp_postmeta WHERE post_id = ? AND meta_key = ?');
    $metaKey   = KW_META_KEY;

    foreach ($planned as &$p) {
        $id = $p['post_id'];
        $fetchPost->bind_param('i', $id);
        $fetchPost->execute();
        $post = $fetchPost->get_result()->fetch_assoc();
        if (!$post || in_array($post['post_type'], ['revision', 'nav_menu_item'], true)
            || in_array($post['post_status'], ['auto-draft', 'inherit'], true)) {
            $errors[] = ['post_id' => $id, 'status' => 'not_found', 'message' => "Post #{$id} no longer exists"];
            continue;
        }
        $fetchMeta->bind_param('is', $id, $metaKey);
        $fetchMeta->execute();
        $current = trim((string) ($fetchMeta->get_result()->fetch_column() ?? ''));
        if ($current !== $p['expected']) {
            $errors[] = [
                'post_id' => $id,
                'status'  => 'conflict',
                'message' => 'Focus keyword was changed elsewhere since you loaded it',
                'current' => $current,
            ];
            continue;
        }
        $p['before'] = $current;
    }
    unset($p);

    if ($errors) {
        $conn->rollback();
        http_response_code(409);
        json_out(false, count($errors) . ' change(s) could not be saved - nothing was written', ['saved' => [], 'errors' => $errors]);
    }

    $modGmt = gmdate('Y-m-d H:i:s');
    $mod    = dw_site_now($conn);

    $delMeta   = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?');
    $delExtra  = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ? AND meta_value <> ?');
    $bump      = $conn->prepare('UPDATE wp_posts SET post_modified = ?, post_modified_gmt = ? WHERE ID = ?');
    $indexable = $hasIndexable
        ? $conn->prepare("UPDATE wp_yoast_indexable SET primary_focus_keyword = ? WHERE object_id = ? AND object_type = 'post'")
        : null;

    foreach ($planned as $p) {
        $id  = $p['post_id'];
        $new = $p['new'];
        if ($new === $p['before']) {
            continue; // no-op
        }
        if ($new === '') {
            $delMeta->bind_param('is', $id, $metaKey);
            $delMeta->execute();
        } else {
            if (!dw_upsert_postmeta($conn, $id, $metaKey, $new)) {
                throw new RuntimeException("upsert failed for post {$id}");
            }
            // Stray duplicate meta rows would keep showing the old value (lists read MAX()).
            $delExtra->bind_param('iss', $id, $metaKey, $new);
            $delExtra->execute();
        }
        if ($indexable) {
            $idxVal = $new === '' ? null : $new;
            $indexable->bind_param('si', $idxVal, $id);
            $indexable->execute();
        }
        $bump->bind_param('ssi', $mod, $modGmt, $id);
        $bump->execute();

        $saved[] = ['post_id' => $id, 'focus_keyword' => $new];
        $log[]   = ['kind' => 'meta', 'post_id' => $id, 'key' => KW_META_KEY, 'before' => $p['before'], 'after' => $new];
    }

    $conn->commit();
} catch (Throwable $e) {
    try { $conn->rollback(); } catch (Throwable $ignored) { /* no open transaction */ }
    error_log('[master-dashboard kw_save ' . $ACTIVE_DB . '] ' . $e->getMessage());
    http_response_code(500);
    json_out(false, 'Save failed because of a database error - nothing was written.', ['saved' => [], 'errors' => []]);
}

$n = count($saved);
if ($n) {
    try {
        if (is_file(__DIR__ . '/lib/activity.php')) require_once __DIR__ . '/lib/activity.php';
        if (function_exists('md_activity_log')) md_activity_log($ACTIVE_DB, [
            'source'   => 'keywords',
            'action'   => 'focus_keyword',
            'summary'  => $n . ' focus keyword' . ($n === 1 ? '' : 's') . ' changed',
            'post_ids' => array_column($saved, 'post_id'),
            'changes'  => $log,
        ]);
    } catch (Throwable $e) {
        error_log('[master-dashboard kw_save activity ' . $ACTIVE_DB . '] ' . $e->getMessage()); // saved anyway
    }
}

json_out(true, $n ? ($n . ' focus keyword' . ($n === 1 ? '' : 's') . ' saved') : 'Nothing to save', [
    'saved'    => $saved,
    'errors'   => [],
    'modified' => $n ? $mod : null,
]);
