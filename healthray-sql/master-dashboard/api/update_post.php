<?php
require __DIR__ . '/bootstrap.php';
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

    default:
        json_out(false, 'Unknown or non-editable field');
}

$ok
    ? json_out(true, 'Saved', ['id' => $id, 'field' => $field, 'value' => $saved] + (isset($previous) ? ['previous' => $previous] : []))
    : json_out(false, 'Update failed: ' . $conn->error);
