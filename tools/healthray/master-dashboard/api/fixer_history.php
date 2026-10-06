<?php
/**
 * GET api/fixer_history.php - the current site's Link Fixer change journal,
 * newest first (for the History drawer). The saved field copies stay on the
 * server; only what the drawer shows is returned.
 */
require __DIR__ . '/bootstrap.php';

$limit = min(2000, max(1, (int) ($_GET['limit'] ?? 500)));

$entries = dw_fx_journal_read($ACTIVE_DB);
$undone = [];
foreach ($entries as $e) {
    if (!empty($e['undo_of'])) {
        $undone[$e['undo_of']] = true;
    }
}

$out = [];
foreach (array_slice(array_reverse($entries), 0, $limit) as $e) {
    unset($e['before'], $e['after_hash']);
    $e['undone'] = isset($undone[$e['id']]);
    $out[] = $e;
}

json_out(true, 'History loaded', ['entries' => $out, 'total' => count($entries)]);
