<?php
/**
 * GET api/activity_list.php?db=[&source=][&q=][&limit=][&offset=] - the unified
 * History: every write made through this dashboard on the current site,
 * newest first (backups/activity-<site>.jsonl, see lib/activity.php).
 *
 * The Link Fixer journal (link-changes-<site>.jsonl) and the Find & Replace
 * journal (replace-history-<site>.jsonl) are merged in at read time, mapped
 * to the same entry shape (ids "fx-<journal id>" / "fr-<op id>"), so history
 * from before the activity log existed still shows - minus any journal line
 * an activity entry already points at (no duplicates). Undo state of entries
 * that point at a journal is taken from that journal, so an undo made in
 * Find & Replace's own drawer shows here too.
 *
 * Response: {entries, total, counts_by_source, recent_24h, all_total, admin_url}
 * Each entry also gets can_undo (bool).
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';
require_once __DIR__ . '/lib/activity.php';

$limit  = max(1, min(1000, (int) ($_GET['limit'] ?? 200)));
$offset = max(0, (int) ($_GET['offset'] ?? 0));
$source = (string) ($_GET['source'] ?? '');
$source = in_array($source, MD_ACTIVITY_SOURCES, true) ? $source : '';
$q      = trim((string) ($_GET['q'] ?? ''));

/* ── journal state ── */
$fxEntries = dw_fx_journal_read($ACTIVE_DB);
$fxUndone  = []; // journal id => undo journal line
foreach ($fxEntries as $e) {
    if (!empty($e['undo_of'])) {
        $fxUndone[$e['undo_of']] = $e;
    }
}
$frOps = [];
foreach (fr_journal_list($ACTIVE_DB) as $op) {
    $frOps[$op['id']] = $op;
}

/* ── journal lines an activity entry already covers ── */
$activity = md_activity_read($ACTIVE_DB);
$covered = ['fixer' => [], 'replace' => []];
foreach ($activity as $e) {
    $ref = is_array($e['ref'] ?? null) ? $e['ref'] : null;
    if (!$ref || !isset($covered[$ref['journal'] ?? ''])) {
        continue;
    }
    foreach ((array) ($ref['ids'] ?? []) as $jid) {
        $covered[$ref['journal']][(string) $jid] = true;
    }
    if (($e['action'] ?? '') !== 'undo' && isset($ref['id'])) {
        $covered[$ref['journal']][(string) $ref['id']] = true;
    }
}

/* ── map uncovered journal lines to activity entries ── */
$extra = [];
foreach ($fxEntries as $e) {
    if (isset($covered['fixer'][$e['id']])) {
        continue;
    }
    $field = ($e['source'] ?? '') === 'faq' ? (string) ($e['meta_key'] ?? '') : 'post_content';
    $verb  = ['replace' => 'updated', 'unlink' => 'unlinked', 'undo' => 'undo of'][$e['action'] ?? ''] ?? (string) ($e['action'] ?? '');
    $extra[] = [
        'id'       => 'fx-' . $e['id'],
        'time'     => (string) ($e['t'] ?? ''),
        'ip'       => '',
        'site'     => $ACTIVE_DB,
        'source'   => 'fixer',
        'action'   => (string) ($e['action'] ?? ''),
        'summary'  => 'Link Fixer: ' . $verb . ' link on #' . (int) $e['post_id'] . ' "' . md_activity_short($e['title'] ?? '', 50) . '"'
            . ($field !== 'post_content' ? " (FAQ $field)" : ''),
        'post_ids' => [(int) $e['post_id']],
        'changes'  => [[
            'kind' => 'link', 'post_id' => (int) $e['post_id'], 'field' => $field,
            'before' => (string) ($e['from'] ?? ''), 'after' => (string) ($e['to'] ?? ''), 'count' => (int) ($e['count'] ?? 1),
            'title' => (string) ($e['title'] ?? ''),
        ]],
        'ref'      => ['journal' => 'fixer', 'id' => $e['id'], 'ids' => [$e['id']]],
        'migrated' => true,
    ];
}
foreach ($frOps as $op) {
    if (isset($covered['replace'][$op['id']])) {
        continue;
    }
    $m = (int) ($op['matches'] ?? 0);
    // Per-field detail from the op backup, when it's a reasonable size to read.
    $postIds = [];
    $fieldChanges = [];
    $opFile = fr_journal_file($op['id']);
    if (is_file($opFile) && filesize($opFile) < 8 * 1024 * 1024) {
        $data = json_decode((string) file_get_contents($opFile), true);
        foreach ((is_array($data['changes'] ?? null) ? $data['changes'] : []) as $c) {
            $postIds[] = (int) ($c['post_id'] ?? 0);
            $fieldChanges[] = ['kind' => 'text', 'post_id' => (int) ($c['post_id'] ?? 0), 'field' => (string) ($c['field'] ?? ''), 'target' => (string) ($c['kind'] ?? ''),
                'count' => (int) ($c['count'] ?? 0), 'before' => (string) ($op['find'] ?? ''), 'after' => (string) ($op['replace'] ?? '')];
        }
        unset($data);
    }
    $extra[] = [
        'id'       => 'fr-' . $op['id'],
        'time'     => (string) ($op['time'] ?? ''),
        'ip'       => (string) ($op['ip'] ?? ''),
        'site'     => $ACTIVE_DB,
        'source'   => 'replace',
        'action'   => 'replace',
        'summary'  => 'Find & Replace: "' . md_activity_short($op['find'] ?? '', 50) . '" → "' . md_activity_short($op['replace'] ?? '', 50) . "\" - $m "
            . ($m === 1 ? 'match' : 'matches') . ' in ' . (int) ($op['fields'] ?? 0) . ' field(s) across ' . (int) ($op['posts'] ?? 0) . ' post(s)',
        'post_ids' => array_values(array_unique(array_filter($postIds))),
        'changes'  => $fieldChanges ?: [['kind' => 'text', 'field' => 'all matched fields', 'before' => (string) ($op['find'] ?? ''), 'after' => (string) ($op['replace'] ?? ''), 'count' => $m]],
        'ref'      => ['journal' => 'replace', 'id' => $op['id']],
        'migrated' => true,
    ];
}

$res = md_activity_list($ACTIVE_DB, ['source' => $source, 'q' => $q], $limit, $offset, $extra);

/* ── undo state per returned entry ── */
foreach ($res['entries'] as &$e) {
    $ref = is_array($e['ref'] ?? null) ? $e['ref'] : null;
    $isUndo = ($e['action'] ?? '') === 'undo';
    if ($ref && ($ref['journal'] ?? '') === 'replace' && !$isUndo) {
        $op = $frOps[$ref['id'] ?? ''] ?? null;
        if (empty($e['undone']) && $op && !empty($op['undone'])) {
            $e['undone'] = ['time' => $op['undone'], 'by' => '', 'restored' => null, 'skipped' => $op['undoSkipped'] ?? null];
        }
        $e['can_undo'] = empty($e['undone']) && $op && is_file(fr_journal_file($op['id']));
    } elseif ($ref && ($ref['journal'] ?? '') === 'fixer') {
        $ids = array_map('strval', (array) ($ref['ids'] ?? [$ref['id'] ?? '']));
        $open = array_values(array_filter($ids, fn($jid) => !isset($fxUndone[$jid])));
        if (empty($e['undone']) && $ids && !$open) {
            $u = $fxUndone[$ids[0]] ?? [];
            $e['undone'] = ['time' => $u['t'] ?? '', 'by' => '', 'restored' => null, 'skipped' => null];
        }
        // An undo is itself journaled, so a fixer undo can be undone in turn.
        $e['can_undo'] = empty($e['undone']) && (bool) $open;
    } else {
        $kinds = array_column(array_filter($e['changes'] ?? [], 'is_array'), 'kind');
        $e['can_undo'] = !$isUndo && empty($e['undone']) && (bool) array_intersect($kinds, ['post', 'meta', 'redirect']);
    }
}
unset($e);

$siteUrl = '';
$r = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
if ($r && ($row = $r->fetch_assoc())) {
    $siteUrl = rtrim((string) $row['option_value'], '/');
}

json_out(true, 'ok', $res + ['admin_url' => preg_match('~^https?://~i', $siteUrl) ? $siteUrl . '/wp-admin/' : '']);
