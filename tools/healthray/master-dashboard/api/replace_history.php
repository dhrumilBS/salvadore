<?php
/** GET api/replace_history.php?db=[&limit=] - past Find & Replace operations for this site, newest first. */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';

$all = fr_journal_list($ACTIVE_DB);
$limit = max(1, min(200, (int) ($_GET['limit'] ?? 200)));
$ops = array_slice($all, 0, $limit);
foreach ($ops as &$op) {
    $op['canUndo'] = empty($op['undone']) && is_file(fr_journal_file($op['id']));
    unset($op['ip']);
}
unset($op);
json_out(true, 'ok', ['ops' => $ops, 'total' => count($all)]);
