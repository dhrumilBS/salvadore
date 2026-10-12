<?php
/**
 * POST api/fixer_write.php - Link Fixer writes, single or bulk.
 * Body: op = replace | unlink
 *       items = JSON [{post_id, href, source, meta_key, new_url (replace only)}, ...]
 * Each item is its own transaction and journal entry (undoable from History);
 * results come back one per item, in order.
 */
require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib/activity.php';
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

// Activity history: one entry per request, pointing at the journal entries
// (which hold the full previous field values and do the undo).
$activityId = null;
$journalIds = [];
$activityChanges = [];
foreach ($results as $i => $r) {
    if (!empty($r['journal_id']) && in_array($r['status'], ['updated', 'removed'], true)) {
        $it = $items[$i];
        $journalIds[] = $r['journal_id'];
        $activityChanges[] = [
            'kind'    => 'link',
            'post_id' => (int) ($it['post_id'] ?? 0),
            'field'   => ($it['source'] ?? 'content') === 'faq' ? (string) ($it['meta_key'] ?? '') : 'post_content',
            'before'  => html_entity_decode((string) ($it['href'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            'after'   => $op === 'unlink' ? '' : trim((string) ($it['new_url'] ?? '')),
            'count'   => $r['count'] ?? 1,
        ];
    }
}
if ($journalIds) {
    $n = count($journalIds);
    $nPosts = count(array_unique(array_column($activityChanges, 'post_id')));
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'fixer',
        'action'  => $op,
        'summary' => 'Link Fixer: ' . ($op === 'unlink' ? 'unlinked ' : 'updated ') . $n . ' link' . ($n === 1 ? '' : 's') . " in $nPosts post" . ($nPosts === 1 ? '' : 's')
            . ($n === 1 ? ' (' . md_activity_short($activityChanges[0]['before'], 70) . ($op === 'unlink' ? '' : ' → ' . md_activity_short($activityChanges[0]['after'], 70)) . ')' : ''),
        'changes' => $activityChanges,
        'ref'     => ['journal' => 'fixer', 'id' => $journalIds[0], 'ids' => $journalIds],
    ]);
}

json_out(true, $done . ' of ' . count($items) . ' link(s) ' . ($op === 'unlink' ? 'unlinked' : 'updated'), [
    'total'   => count($items),
    'done'    => $done,
    'results' => $results,
] + ($activityId ? ['activity_id' => $activityId] : []));
