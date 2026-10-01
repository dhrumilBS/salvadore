<?php
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirect_store.php';
require_post_method();

/*
 * Thin write endpoint over lib/redirect_store.php's dw_redirect_upsert() -
 * used by the "trash a post -> add a 410?" prompts on the Content and Bulk
 * URL Update tabs, and generic enough to cover any other redirect type
 * later. Defaults to a 410 Gone (no destination) since that's the one
 * actual caller today.
 */

$origin  = trim((string) ($_POST['origin'] ?? ''));
$type    = (int) ($_POST['type'] ?? 410);
$target  = (string) ($_POST['target'] ?? '');
$replace = !empty($_POST['replace']);

if ($origin === '') {
    json_out(false, 'Origin URL is required');
}

$result = dw_redirect_upsert($conn, $origin, $type, $target, $replace, $ACTIVE_DB);

json_out($result['status'] !== 'error', $result['msg'], $result);
