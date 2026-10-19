<?php
require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

/*
 * Inline-edit endpoint for the export table. One field per call, keyed by
 * the same field names the tool displays/exports, so the export always
 * reads the freshly-saved value straight back out of the database.
 */

$id    = (int) ($_POST['id'] ?? 0);
$field = trim((string) ($_POST['field'] ?? ''));
$value = (string) ($_POST['value'] ?? '');

if ($id <= 0) {
    json_out(false, 'Invalid ID');
}

// Activity history: read the "before" values under a row lock in the same
// transaction as the write, so the logged before/after is exactly what changed.
// (An early json_out() exits without commit - the connection closing rolls back.)
$conn->begin_transaction();
$stmt = $conn->prepare('SELECT post_title, post_name, post_status, post_date, post_date_gmt FROM wp_posts WHERE ID = ? FOR UPDATE');
$stmt->bind_param('i', $id);
$stmt->execute();
$beforeRow = $stmt->get_result()->fetch_assoc() ?: null;
$metaKeyFor = ['meta_title' => '_yoast_wpseo_title', 'meta_description' => '_yoast_wpseo_metadesc'] + DW_ROBOTS_META;
$beforeMeta = null;
if (isset($metaKeyFor[$field])) {
    $stmt = $conn->prepare('SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? ORDER BY meta_id LIMIT 1 FOR UPDATE');
    $stmt->bind_param('is', $id, $metaKeyFor[$field]);
    $stmt->execute();
    $mrow = $stmt->get_result()->fetch_assoc();
    $beforeMeta = $mrow ? $mrow['meta_value'] : null;
}

switch ($field) {
    case 'title':
        $stmt = $conn->prepare('UPDATE wp_posts SET post_title = ? WHERE ID = ?');
        $stmt->bind_param('si', $value, $id);
        $ok = $stmt->execute();
        $saved = $value;
        break;

    case 'slug':
        $slug = dw_sanitize_slug($value);
        if ($slug === '') {
            json_out(false, 'Slug cannot be empty');
        }
        // WordPress keeps slugs unique per post type (and per parent for pages);
        // a duplicate would make one of the two URLs unreachable.
        $stmt = $conn->prepare("SELECT o.ID FROM wp_posts o JOIN wp_posts p ON p.ID = ?
            WHERE o.post_name = ? AND o.post_type = p.post_type AND o.post_parent = p.post_parent AND o.ID <> p.ID
              AND o.post_status NOT IN ('trash', 'auto-draft', 'inherit')
            LIMIT 1");
        $stmt->bind_param('is', $id, $slug);
        $stmt->execute();
        $clash = $stmt->get_result()->fetch_assoc();
        if ($clash) {
            json_out(false, "Slug \"{$slug}\" is already used by post #{$clash['ID']} - pick another one.");
        }
        $stmt = $conn->prepare('UPDATE wp_posts SET post_name = ? WHERE ID = ?');
        $stmt->bind_param('si', $slug, $id);
        $ok = $stmt->execute();
        $saved = $slug;
        break;

    case 'status':
        $validStatuses = dw_writable_statuses();
        if (!in_array($value, $validStatuses, true)) {
            json_out(false, 'Invalid status');
        }
        // Report what it was, so the client decides "just trashed -> offer a 410"
        // from the database rather than from a possibly stale row on screen.
        $stmt = $conn->prepare('SELECT post_status FROM wp_posts WHERE ID = ?');
        $stmt->bind_param('i', $id);
        $stmt->execute();
        $previous = $stmt->get_result()->fetch_column();
        if ($previous === false) {
            json_out(false, 'Post not found');
        }
        $stmt = $conn->prepare('UPDATE wp_posts SET post_status = ? WHERE ID = ?');
        $stmt->bind_param('si', $value, $id);
        $ok = $stmt->execute();
        $saved = $value;
        break;

    case 'publish_date':
        $dt = DateTime::createFromFormat('Y-m-d H:i:s', $value) ?: DateTime::createFromFormat('Y-m-d\TH:i', $value);
        if (!$dt) {
            json_out(false, 'Invalid date - expected YYYY-MM-DD HH:MM:SS');
        }
        $localStr = $dt->format('Y-m-d H:i:s');
        // DateTime::modify() mis-parses fractional-hour offsets (e.g. "-5.5 hours"
        // silently comes out as +5 hours) - convert to whole seconds first.
        $offsetSeconds = (int) round(dw_gmt_offset_hours($conn) * 3600);
        $gmt = clone $dt;
        $gmt->modify(($offsetSeconds >= 0 ? '-' : '+') . abs($offsetSeconds) . ' seconds');
        $gmtStr = $gmt->format('Y-m-d H:i:s');

        $stmt = $conn->prepare('UPDATE wp_posts SET post_date = ?, post_date_gmt = ? WHERE ID = ?');
        $stmt->bind_param('ssi', $localStr, $gmtStr, $id);
        $ok = $stmt->execute();
        $saved = $localStr;
        break;

    case 'meta_title':
        $ok = dw_upsert_postmeta($conn, $id, '_yoast_wpseo_title', $value);
        $saved = $value;
        break;

    case 'meta_description':
        $ok = dw_upsert_postmeta($conn, $id, '_yoast_wpseo_metadesc', $value);
        $saved = $value;
        break;

    case 'robots_index':
    case 'robots_follow':
        // Yoast "Advanced" settings: the default ("type default" / follow) is no meta row, like Yoast's editor saves it.
        $metaValue = dw_robots_meta_value($field, $value);
        if ($metaValue === false) {
            json_out(false, 'Invalid value');
        }
        $metaKey = DW_ROBOTS_META[$field];
        if ($metaValue === null) {
            $stmt = $conn->prepare('DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?');
            $stmt->bind_param('is', $id, $metaKey);
            $ok = $stmt->execute();
        } else {
            $ok = dw_upsert_postmeta($conn, $id, $metaKey, $metaValue);
        }
        if ($ok) {
            dw_robots_sync_indexable($conn, $id, $metaKey, $metaValue);
        }
        $saved = $value;
        break;

    default:
        json_out(false, 'Unknown or non-editable field');
}

if (!$ok) {
    $err = $conn->error;
    $conn->rollback();
    json_out(false, 'Update failed: ' . $err);
}
$conn->commit();

$activityId = null;
if ($beforeRow || isset($metaKeyFor[$field])) {
    $changes = [];
    $colFor = ['title' => 'post_title', 'slug' => 'post_name', 'status' => 'post_status'];
    if (isset($colFor[$field]) && $beforeRow) {
        $changes[] = ['kind' => 'post', 'post_id' => $id, 'field' => $colFor[$field], 'before' => $beforeRow[$colFor[$field]], 'after' => $saved];
    } elseif ($field === 'publish_date' && $beforeRow) {
        $changes[] = ['kind' => 'post', 'post_id' => $id, 'field' => 'post_date', 'before' => $beforeRow['post_date'], 'after' => $localStr];
        $changes[] = ['kind' => 'post', 'post_id' => $id, 'field' => 'post_date_gmt', 'before' => $beforeRow['post_date_gmt'], 'after' => $gmtStr];
    } elseif (isset($metaKeyFor[$field])) {
        $changes[] = ['kind' => 'meta', 'post_id' => $id, 'key' => $metaKeyFor[$field], 'before' => $beforeMeta, 'after' => isset(DW_ROBOTS_META[$field]) ? $metaValue : $saved];
    }
    $changes = array_values(array_filter($changes, fn($c) => !($c['before'] === null && $c['after'] === null)
        && ((string) $c['before'] !== (string) $c['after'] || $c['before'] === null)));
    if ($changes) {
        $labels = ['title' => 'title', 'slug' => 'slug', 'status' => 'status', 'publish_date' => 'publish date', 'meta_title' => 'meta title', 'meta_description' => 'meta description',
            'robots_index' => 'show in search results', 'robots_follow' => 'follow links'];
        $title  = $beforeRow ? md_activity_short($beforeRow['post_title'], 50) : '';
        $fromText = md_activity_short($changes[0]['before'] ?? '', 40) ?: '(empty)';
        $toText   = md_activity_short($changes[0]['after'], 40) ?: '(empty)';
        if (isset(DW_ROBOTS_META[$field])) { // in Yoast's words, not the raw '1' / '2'
            $robotsLabel = fn($v) => ['' => 'Default', 'index' => 'Yes', 'noindex' => 'No', 'follow' => 'Yes', 'nofollow' => 'No'][dw_robots_field_value($field, $v)];
            $fromText = $robotsLabel($changes[0]['before']);
            $toText   = $robotsLabel($changes[0]['after']);
        }
        $activityId = md_activity_log($ACTIVE_DB, [
            'source'  => 'content',
            'action'  => $field,
            'summary' => "Post #{$id}" . ($title !== '' ? " \"{$title}\"" : '') . ": {$labels[$field]} "
                . "{$fromText} → {$toText}",
            'changes' => $changes,
        ]);
    }
}

json_out(true, 'Saved', ['id' => $id, 'field' => $field, 'value' => $saved] + (isset($previous) ? ['previous' => $previous] : []) + ($activityId ? ['activity_id' => $activityId] : []));
