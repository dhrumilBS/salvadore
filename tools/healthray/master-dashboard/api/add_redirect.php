<?php
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirect_store.php';
require_once __DIR__ . '/lib/activity.php';
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

// Activity history: before/after of the rule (dw_redirect_upsert read
// 'previous' under the same lock it wrote with).
if (in_array($result['status'], ['created', 'updated'], true)) {
    $prev = $result['previous'] ?? null;
    $ruleOrigin = $prev['origin'] ?? $result['origin'];
    $after = ['url' => (string) $result['target'], 'type' => (int) $result['type']];
    $describe = fn($r) => $r['type'] . ($r['url'] !== '' ? ' → /' . $r['url'] . '/' : ' Gone');
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'redirects',
        'action'  => $result['status'] === 'created' ? 'redirect_add' : 'redirect_replace',
        'summary' => ($result['status'] === 'created' ? 'Added redirect ' : 'Replaced redirect ') . '/' . $ruleOrigin . '/: '
            . ($prev ? $describe(['url' => (string) $prev['url'], 'type' => (int) $prev['type']]) . ' ⇒ ' : '') . $describe($after),
        'changes' => [[
            'kind'   => 'redirect',
            'origin' => $ruleOrigin,
            'before' => $prev ? ['url' => (string) $prev['url'], 'type' => (int) $prev['type']] : null,
            'after'  => $after,
        ]],
    ]);
    if ($activityId) {
        $result['activity_id'] = $activityId;
    }
}

json_out($result['status'] !== 'error', $result['msg'], $result);
