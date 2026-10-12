<?php
/**
 * POST api/fixer_undo.php - id=<journal entry id>. Puts back the field value
 * that Link Fixer change overwrote, but only if nothing has touched that
 * field since (see dw_fx_undo()).
 */
require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[a-f0-9]{16}$/', $id)) {
    json_out(false, 'Invalid change id');
}

$r = dw_fx_undo($conn, $ACTIVE_DB, $id);
if ($r['status'] === 'undone') {
    $t = $r['undone'];
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'fixer',
        'action'  => 'undo',
        'summary' => 'Undid Link Fixer change on #' . (int) $t['post_id'] . ': ' . md_activity_short($t['to'] ?: '(unlinked)', 60) . ' → ' . md_activity_short($t['from'], 60),
        'changes' => [['kind' => 'link', 'post_id' => (int) $t['post_id'], 'field' => $t['source'] === 'faq' ? (string) $t['meta_key'] : 'post_content', 'before' => (string) $t['to'], 'after' => (string) $t['from']]],
        'ref'     => ['journal' => 'fixer', 'ids' => [$r['journal_id']], 'undo_of' => [$id]],
    ]);
    if ($activityId) {
        $r['activity_id'] = $activityId;
    }
}
json_out($r['status'] === 'undone', $r['message'] ?? 'Change undone', $r);
