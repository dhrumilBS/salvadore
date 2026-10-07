<?php
/** GET api/history.php?db= - past replace operations for this site, newest first. */
require __DIR__ . '/lib.php';

$ops = array_slice(fr_journal_list($ACTIVE_DB), 0, 200);
foreach ($ops as &$op) {
    $op['canUndo'] = empty($op['undone']) && is_file(fr_journal_file($op['id']));
    unset($op['ip']);
}
unset($op);
json_out(true, 'ok', ['ops' => $ops]);
