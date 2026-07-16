<?php
/**
 * POST api/delete — delete options (CSRF-protected).
 *
 * mode=ids:   {ids: [1,2,3]}                       — selected rows
 * mode=match: {column, match, value, confirm:true} — everything matching a search
 */
require_once __DIR__ . '/_bootstrap.php';

require_post();
require_auth();
require_csrf();

require_once __DIR__ . '/_db.php';
$conn = require_db();

$mode = (string) ($_POST['mode'] ?? 'ids');

if ($mode === 'ids') {

    $ids = $_POST['ids'] ?? [];
    if (!is_array($ids)) {
        json_error('ids must be an array.', 422);
    }
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($n) => $n > 0)));
    if (!$ids) {
        json_error('No valid ids supplied.', 422);
    }
    if (count($ids) > 500) {
        json_error('Too many ids in one request (max 500).', 422);
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    try {
        $stmt = $conn->prepare("DELETE FROM wp_options WHERE option_id IN ($placeholders)");
        $stmt->bind_param(str_repeat('i', count($ids)), ...$ids);
        $stmt->execute();
        $deleted = $stmt->affected_rows;
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        json_error('Delete failed: ' . $e->getMessage(), 500);
    }

    json_out(['success' => true, 'deleted' => $deleted]);
}

if ($mode === 'match') {

    if (($_POST['confirm'] ?? null) !== true && ($_POST['confirm'] ?? '') !== 'true') {
        json_error('Bulk delete requires explicit confirmation.', 422);
    }

    $column = (string) ($_POST['column'] ?? '');
    if (!in_array($column, WP_OPTION_COLUMNS, true)) {
        json_error('Invalid column.', 422);
    }

    $match = (string) ($_POST['match'] ?? 'contains');
    if (!in_array($match, MATCH_MODES, true)) {
        $match = 'contains';
    }

    $value = (string) ($_POST['value'] ?? '');
    if ($value === '') {
        json_error('A search value is required — refusing to delete the whole table.', 422);
    }

    if ($match === 'exact') {
        $sql   = "DELETE FROM wp_options WHERE `$column` = ?";
        $param = $value;
    } else {
        $sql   = "DELETE FROM wp_options WHERE `$column` LIKE ?";
        $param = like_pattern($value, $match);
    }

    try {
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('s', $param);
        $stmt->execute();
        $deleted = $stmt->affected_rows;
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        json_error('Delete failed: ' . $e->getMessage(), 500);
    }

    json_out(['success' => true, 'deleted' => $deleted]);
}

json_error('Unknown mode. Use "ids" or "match".', 422);
