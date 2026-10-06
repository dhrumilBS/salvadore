<?php
/**
 * POST api/fixer_write.php - Link Fixer writes, single or bulk.
 * Body: op = replace | unlink
 *       items = JSON [{post_id, href, source, meta_key, new_url (replace only)}, ...]
 * Each item is its own transaction and journal entry (undoable from History);
 * results come back one per item, in order.
 */
require __DIR__ . '/bootstrap.php';
require_post_method();

const DW_FX_MAX_ITEMS = 1000;

$op = $_POST['op'] ?? '';
if (!in_array($op, ['replace', 'unlink'], true)) {
    json_out(false, 'Unknown operation');
}

$items = json_decode((string) ($_POST['items'] ?? ''), true);
if (!is_array($items) || !array_is_list($items) || !$items) {
    json_out(false, 'items must be a non-empty JSON array');
}
if (count($items) > DW_FX_MAX_ITEMS) {
    json_out(false, 'Too many links in one request (max ' . DW_FX_MAX_ITEMS . ')');
}

set_time_limit(0);
$results = [];
$done = 0;
foreach ($items as $item) {
    $r = is_array($item) ? dw_fx_apply($conn, $op, $item, $ACTIVE_DB) : ['status' => 'error', 'message' => 'Malformed item'];
    if (in_array($r['status'], ['updated', 'removed'], true)) {
        $done++;
    }
    $results[] = $r;
}

json_out(true, $done . ' of ' . count($items) . ' link(s) ' . ($op === 'unlink' ? 'unlinked' : 'updated'), [
    'total'   => count($items),
    'done'    => $done,
    'results' => $results,
]);
