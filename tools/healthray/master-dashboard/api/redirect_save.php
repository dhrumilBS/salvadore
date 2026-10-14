<?php
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirects.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

/*
 * Redirects tab writes: add / edit / delete / bulk import, over
 * lib/redirect_store.php's dw_redirect_apply() (one locked transaction,
 * all-or-nothing, backup first, base + export options kept in sync).
 *
 * POST ops=<JSON [{action, from?, origin, format, type, url}]> (max 1000)
 *      dry_run=1  validate only - the UI previews with this before its confirmDialog()
 *      replace=1  an "add" whose origin already has a rule overwrites it
 * Response: {success, status, msg, results:[{i, ok, error, action, origin, format, before, after, warnings, unchanged?}], activity_id?}
 */

const MD_REDIRECT_OPS_MAX = 1000;

$ops = json_decode((string) ($_POST['ops'] ?? ''), true);
if (!is_array($ops) || !$ops) {
    json_out(false, 'No redirect changes were sent.');
}
if (count($ops) > MD_REDIRECT_OPS_MAX) {
    json_out(false, 'At most ' . MD_REDIRECT_OPS_MAX . ' redirects per save.');
}
$dryRun  = !empty($_POST['dry_run']);
$replace = !empty($_POST['replace']);

$home   = dw_home_url($conn);
$result = dw_redirect_apply($conn, $ops, $ACTIVE_DB, $dryRun, $replace, $home);

/*
 * Advisory warnings (never block): a new plain origin that is still a live
 * post would hide that post; a plain destination that isn't a live post sends
 * visitors to a dead page. Same matching as the list's "Origin/Destination match".
 */
$paths = [];
foreach ($result['results'] as $r) {
    if ($r['ok'] && $r['format'] === 'plain' && $r['after'] !== null && empty($r['unchanged'])) {
        $paths[] = $r['origin'];
        if ($r['after']['url'] !== '' && !preg_match('~^([a-z][a-z0-9+.-]*:)?//~i', $r['after']['url'])) {
            $paths[] = strtok($r['after']['url'], '?');
        }
    }
}
if ($paths) {
    $posts = dw_resolve_paths_to_posts($conn, $paths);
    $live  = fn($p) => $p !== null && in_array($p['status'], dw_live_statuses(), true);
    foreach ($result['results'] as &$r) {
        if (!$r['ok'] || $r['format'] !== 'plain' || $r['after'] === null || !empty($r['unchanged'])) {
            continue;
        }
        $o = $posts[trim($r['origin'], '/')] ?? null;
        if ($live($o)) {
            $r['warnings'][] = 'The origin is still a live ' . $o['post_type'] . ' (#' . $o['id'] . ' "' . html_entity_decode($o['title'], ENT_QUOTES) . '") - the redirect will hide it.';
        }
        $u = $r['after']['url'];
        if ($u !== '' && !preg_match('~^([a-z][a-z0-9+.-]*:)?//~i', $u)) {
            $key = trim((string) strtok($u, '?'), '/');
            if (array_key_exists($key, $posts) && !$live($posts[$key])) {
                $r['warnings'][] = 'The destination /' . $key . '/ does not match a live post or page.';
            }
        }
    }
    unset($r);
}

$extra = ['status' => $result['status'], 'results' => $result['results']];
foreach (['backup_file', 'total_rules'] as $k) {
    if (isset($result[$k])) {
        $extra[$k] = $result[$k];
    }
}

if ($result['status'] === 'saved') {
    $actions = array_unique(array_column(array_filter($result['results'], fn($r) => empty($r['unchanged'])), 'action'));
    $n       = count(array_filter($result['results'], fn($r) => empty($r['unchanged'])));
    $label   = fn($v) => $v === null ? 'none' : $v['type'] . ($v['url'] !== '' ? ' → /' . $v['url'] . '/' : ' Gone');

    if ($n === 1) {
        $one = array_values(array_filter($result['results'], fn($r) => empty($r['unchanged'])))[0];
        $verb = ['add' => $one['before'] ? 'Replaced redirect ' : 'Added redirect ', 'edit' => 'Edited redirect ', 'delete' => 'Deleted redirect '][$one['action']];
        $summary = $verb . ($one['format'] === 'regex' ? $one['origin'] . ' (regex)' : '/' . $one['origin'] . '/') . ': '
            . ($one['before'] ? $label($one['before']) . ($one['after'] ? ' ⇒ ' : '') : '') . ($one['after'] ? $label($one['after']) : '');
        $action = 'redirect_' . $one['action'];
    } else {
        $counts = array_count_values(array_column(array_filter($result['results'], fn($r) => empty($r['unchanged'])), 'action'));
        $parts = [];
        foreach (['add' => 'added', 'edit' => 'edited', 'delete' => 'deleted'] as $k => $w) {
            if (!empty($counts[$k])) {
                $parts[] = $counts[$k] . ' ' . $w;
            }
        }
        $summary = 'Redirects: ' . implode(', ', $parts);
        $action  = count($actions) === 1 ? 'redirect_' . reset($actions) . '_bulk' : 'redirect_bulk';
    }

    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'redirects',
        'action'  => $action,
        'summary' => $summary,
        'changes' => $result['changes'],
    ]);
    if ($activityId) {
        $extra['activity_id'] = $activityId;
    }
}

json_out(in_array($result['status'], ['saved', 'unchanged', 'preview'], true), $result['msg'], $extra);
