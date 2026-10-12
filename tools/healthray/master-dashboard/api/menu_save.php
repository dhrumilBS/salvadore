<?php
/**
 * POST api/menu_save.php - Menu Order tab: apply a batch of edits atomically.
 *
 * Body (JSON): { post_type, changes: [ { id, modified, title?, slug?, date?, menu_order? } ] }
 *
 * Every change is validated first (inside one transaction, with the rows
 * locked), and if any fails nothing is written:
 *   - `modified` is required and must still equal the row's post_modified
 *     (optimistic lock: refuse to overwrite a post edited after it was loaded)
 *   - title not empty; slug sanitized, not empty, unique among its siblings
 *     (in the DB and within this batch); date parsed in the site's timezone;
 *     menu_order a whole number.
 *
 * Responses (all via json_out):
 *   ok:      { success: true,  msg, updated, modified, items: [{ id, post_title?, post_name?, post_date?, post_date_gmt?, menu_order? }] }
 *   invalid: { success: false, msg, invalid: true, errors: [{ id, message }] }   (HTTP 200, nothing written)
 *   error:   { success: false, msg }                                             (HTTP 4xx/5xx, nothing written)
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/menu_order.php';
require_once __DIR__ . '/lib/activity.php';

require_post_method();

const MO_MAX_CHANGES = 5000;

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    json_out(false, 'Invalid request body');
}
$changes  = $body['changes'] ?? null;
$postType = $body['post_type'] ?? 'page';

if (!is_array($changes) || !$changes || !array_is_list($changes)) {
    http_response_code(400);
    json_out(false, 'No changes provided');
}
if (!is_string($postType) || $postType === '') {
    http_response_code(400);
    json_out(false, 'Invalid post type');
}
if (count($changes) > MO_MAX_CHANGES) {
    http_response_code(400);
    json_out(false, 'Too many changes in one save (max ' . MO_MAX_CHANGES . ')');
}

$errors  = [];
$planned = [];

try {
    $tz = mo_site_timezone($conn);

    // Validate inside the transaction with the rows locked, so nothing can
    // modify a post between its optimistic-lock check and the write.
    $conn->begin_transaction();

    $fetch = $conn->prepare('SELECT ID, post_type, post_parent, post_modified, post_title, post_name, post_date, post_date_gmt, menu_order FROM wp_posts WHERE ID = ? LIMIT 1 FOR UPDATE');
    $slugTaken = $conn->prepare(
        "SELECT ID FROM wp_posts
         WHERE post_name = ? AND post_type = ? AND post_parent = ? AND ID <> ?
           AND post_status NOT IN ('trash', 'auto-draft', 'inherit') LIMIT 1"
    );
    $batchSlugs = [];
    $seenIds    = [];

    foreach ($changes as $c) {
        $id = is_array($c) ? (int) ($c['id'] ?? 0) : 0;
        $fail = function ($msg) use (&$errors, $id) {
            $errors[] = ['id' => $id, 'message' => $msg];
        };

        if (!is_array($c) || $id <= 0) { $fail('Invalid change'); continue; }
        if (isset($seenIds[$id])) { $fail('Listed twice in this save'); continue; }
        $seenIds[$id] = true;

        $fetch->bind_param('i', $id);
        $fetch->execute();
        $row = $fetch->get_result()->fetch_assoc();
        if (!$row) { $fail('Post not found'); continue; }
        if ($row['post_type'] !== $postType) { $fail('Post type mismatch'); continue; }

        // Optimistic lock - required. Someone (WordPress, another tab) may
        // have saved this post after it was loaded.
        if (!isset($c['modified']) || !is_string($c['modified']) || $c['modified'] === '') {
            $fail('Missing last-modified time - reload and try again');
            continue;
        }
        if ($c['modified'] !== $row['post_modified']) {
            $fail('Changed elsewhere since you loaded it — reload to get the latest version');
            continue;
        }

        $set = [];
        if (array_key_exists('title', $c)) {
            $title = is_scalar($c['title']) ? trim((string) $c['title']) : '';
            if ($title === '') { $fail('Title cannot be empty'); continue; }
            $set['post_title'] = $title;
        }
        if (array_key_exists('slug', $c)) {
            $slug = is_scalar($c['slug']) ? mo_sanitize_slug($c['slug']) : '';
            if ($slug === '') { $fail('Slug cannot be empty'); continue; }
            if (strlen($slug) > 200) { $fail('Slug is too long (max 200 characters)'); continue; }
            $parent = (int) $row['post_parent'];
            $slugTaken->bind_param('ssii', $slug, $postType, $parent, $id);
            $slugTaken->execute();
            $clash = $slugTaken->get_result()->fetch_assoc();
            if ($clash) { $fail("Slug “{$slug}” is already used by #{$clash['ID']}"); continue; }
            $batchKey = $parent . '/' . $slug;
            if (isset($batchSlugs[$batchKey])) { $fail("Slug “{$slug}” is used twice in this save"); continue; }
            $batchSlugs[$batchKey] = true;
            $set['post_name'] = $slug;
        }
        if (array_key_exists('date', $c)) {
            $raw = is_string($c['date']) ? str_replace('T', ' ', trim($c['date'])) : '';
            $dt  = DateTime::createFromFormat('!Y-m-d H:i:s', $raw, $tz)
                ?: DateTime::createFromFormat('!Y-m-d H:i', $raw, $tz);
            // createFromFormat rolls over impossible dates (Feb 31) - refuse those.
            $errs = DateTime::getLastErrors();
            if (!$dt || ($errs && ($errs['warning_count'] || $errs['error_count']))) { $fail('Invalid date'); continue; }
            $set['post_date']     = $dt->format('Y-m-d H:i:s');
            $set['post_date_gmt'] = (clone $dt)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        }
        if (array_key_exists('menu_order', $c)) {
            $mo = $c['menu_order'];
            $whole = is_int($mo) || (is_string($mo) && preg_match('/^-?\d{1,10}$/', trim($mo)));
            if (!$whole || abs((int) $mo) > 2147483647) {
                $fail('Menu order must be a whole number');
                continue;
            }
            $set['menu_order'] = (int) $mo;
        }
        if ($set) {
            $planned[] = ['id' => $id, 'set' => $set, 'before' => $row]; // 'before' (locked row) feeds the activity log only
        }
    }

    if ($errors) {
        $conn->rollback();
        json_out(false, count($errors) . ' change(s) could not be saved — nothing was written', [
            'invalid' => true,
            'errors'  => $errors,
        ]);
    }
    if (!$planned) {
        $conn->rollback();
        json_out(true, 'Nothing to save', ['updated' => 0, 'modified' => null, 'items' => []]);
    }

    $now    = new DateTime('now', $tz);
    $mod    = $now->format('Y-m-d H:i:s');
    $modGmt = (clone $now)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');

    foreach ($planned as $p) {
        $cols   = array_keys($p['set']);
        $values = array_values($p['set']);
        // Column names come from the fixed keys above, never from the request.
        $sql    = 'UPDATE wp_posts SET ' . implode(', ', array_map(fn($col) => "{$col} = ?", $cols))
            . ', post_modified = ?, post_modified_gmt = ? WHERE ID = ?';
        $types  = implode('', array_map(fn($col) => $col === 'menu_order' ? 'i' : 's', $cols)) . 'ssi';
        $values = array_merge($values, [$mod, $modGmt, $p['id']]);
        $stmt   = $conn->prepare($sql);
        $stmt->bind_param($types, ...$values);
        $stmt->execute();
    }
    $conn->commit();
} catch (Throwable $e) {
    try { $conn->rollback(); } catch (Throwable $ignored) { /* no open transaction */ }
    error_log('[master-dashboard menu_save ' . $ACTIVE_DB . '] ' . $e->getMessage());
    http_response_code(500);
    json_out(false, 'Save failed because of a database error — nothing was written.');
}

// Activity history: one entry per save, every changed column with its before value.
$activityChanges = [];
foreach ($planned as $p) {
    foreach ($p['set'] as $col => $val) {
        if ((string) $p['before'][$col] !== (string) $val) {
            $activityChanges[] = ['kind' => 'post', 'post_id' => $p['id'], 'field' => $col, 'before' => $col === 'menu_order' ? (int) $p['before'][$col] : $p['before'][$col], 'after' => $val, 'title' => md_activity_short($p['before']['post_title'], 80)];
        }
    }
}
$activityId = null;
if ($activityChanges) {
    $nPosts = count(array_unique(array_column($activityChanges, 'post_id')));
    $cols   = array_unique(array_map(fn($c) => ['post_title' => 'title', 'post_name' => 'slug', 'post_date' => 'date', 'post_date_gmt' => 'date', 'menu_order' => 'order'][$c['field']] ?? $c['field'], $activityChanges));
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'menu',
        'action'  => 'save',
        'summary' => "Menu Order ({$postType}): saved " . implode('/', $cols) . " on {$nPosts} post" . ($nPosts === 1 ? '' : 's')
            . ($nPosts === 1 ? ' (#' . $activityChanges[0]['post_id'] . ' "' . $activityChanges[0]['title'] . '")' : ''),
        'changes' => $activityChanges,
    ]);
}

json_out(true, 'Saved', [
    'updated'  => count($planned),
    'modified' => $mod,
    // The saved values as stored, so the UI can sync (e.g. sanitized slugs).
    'items'    => array_map(fn($p) => ['id' => $p['id']] + $p['set'], $planned),
] + ($activityId ? ['activity_id' => $activityId] : []));
