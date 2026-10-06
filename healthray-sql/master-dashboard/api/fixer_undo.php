<?php
/**
 * POST api/fixer_undo.php - id=<journal entry id>. Puts back the field value
 * that Link Fixer change overwrote, but only if nothing has touched that
 * field since (see dw_fx_undo()).
 */
require __DIR__ . '/bootstrap.php';
require_post_method();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[a-f0-9]{16}$/', $id)) {
    json_out(false, 'Invalid change id');
}

$r = dw_fx_undo($conn, $ACTIVE_DB, $id);
json_out($r['status'] === 'undone', $r['message'] ?? 'Change undone', $r);
