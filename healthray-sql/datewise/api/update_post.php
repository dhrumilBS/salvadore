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
        $stmt = $conn->prepare('UPDATE wp_posts SET post_name = ? WHERE ID = ?');
        $stmt->bind_param('si', $slug, $id);
        $ok = $stmt->execute();
        $saved = $slug;
        break;

    case 'status':
        $validStatuses = ['publish', 'draft', 'pending', 'private', 'future', 'trash'];
        if (!in_array($value, $validStatuses, true)) {
            json_out(false, 'Invalid status');
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
    ? json_out(true, 'Saved', ['id' => $id, 'field' => $field, 'value' => $saved])
    : json_out(false, 'Update failed: ' . $conn->error);
