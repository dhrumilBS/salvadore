<?php
/**
 * POST api/replace_undo.php?db= - restore the values a replace operation changed.
 * A field edited again since then (its value is no longer what we wrote) is
 * left alone and reported, so an undo never overwrites newer work.
 * The work is fr_undo_op() (lib/find_replace.php), shared with the unified
 * History's activity_undo.php.
 * JSON body: {id}
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

$id = fr_body()['id'] ?? '';
$id = is_string($id) ? $id : '';

$r = fr_undo_op($conn, $ACTIVE_DB, $id);
if (!$r['success']) {
    json_out(false, $r['msg']);
}

$op = $r['op'];
$activityId = md_activity_log($ACTIVE_DB, [
    'source'  => 'replace',
    'action'  => 'undo',
    'summary' => 'Undid Find & Replace "' . md_activity_short($op['find'] ?? '', 50) . '" → "' . md_activity_short($op['replace'] ?? '', 50) . "\": restored {$r['restored']} field" . ($r['restored'] === 1 ? '' : 's')
        . ($r['skipped'] ? ', ' . count($r['skipped']) . ' skipped' : ''),
    'ref'     => ['journal' => 'replace', 'id' => $id],
    'skipped' => $r['skipped'],
]);

json_out(true, $r['msg'], ['restored' => $r['restored'], 'skipped' => $r['skipped'], 'logged' => $r['logged']] + ($activityId ? ['activity_id' => $activityId] : []));
