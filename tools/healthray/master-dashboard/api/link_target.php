<?php
/**
 * POST api/link_target.php - Links tab "New-tab rule": internal links open in the same tab,
 * external links in a new tab (target="_blank" + rel="noopener"). See dw_fx_target_rule().
 *
 * Body: scope    = page (post_ids = JSON list, max 500) | site (the Links tab's filters:
 *                  post_type, status, search, date_from/to, mod_from/to - capped at dw_links_row_cap() posts)
 *       dry_run  = 1 -> counts only, nothing written (the UI previews with this before its confirmDialog())
 * Covers post_content and FAQ answer fields. Each changed field is its own transaction + Link Fixer
 * journal entry (undo per post from History); one activity entry per request.
 * Response: {success, msg, posts, fields, internal, external, items:[{post_id, title, internal, external}], capped?, activity_id?}
 */
require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib/activity.php';
require_post_method();

const DW_LT_MAX_IDS = 500;

$scope  = ($_POST['scope'] ?? '') === 'site' ? 'site' : 'page';
$dryRun = !empty($_POST['dry_run']);
$cap    = dw_links_row_cap();

if ($scope === 'page') {
    $ids = json_decode((string) ($_POST['post_ids'] ?? ''), true);
    if (!is_array($ids) || !$ids) {
        json_out(false, 'No posts were sent.');
    }
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($id) => $id > 0)));
    if (count($ids) > DW_LT_MAX_IDS) {
        json_out(false, 'At most ' . DW_LT_MAX_IDS . ' posts per request.');
    }
    $capped = false;
} else {
    $f = dw_parse_input($_POST, dw_known_post_types($conn));
    [$where, $params] = dw_build_where($f);
    // Only posts that can contain a link: <a in the content, or an FAQ answer field with one.
    $where .= " AND (p.post_content LIKE '%<a%' OR EXISTS (SELECT 1 FROM wp_postmeta fm WHERE fm.post_id = p.ID
        AND fm.meta_key NOT LIKE '\\_%' AND fm.meta_key REGEXP ? AND fm.meta_value LIKE '%<a%'))";
    $params[] = ['type' => 's', 'value' => DW_FX_FAQ_KEY_REGEX];
    $stmt = $conn->prepare("SELECT p.ID FROM wp_posts p WHERE $where ORDER BY p.ID LIMIT ?");
    $params[] = ['type' => 'i', 'value' => $cap + 1];
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $ids = array_map('intval', array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), 'ID'));
    $capped = count($ids) > $cap;
    $ids = array_slice($ids, 0, $cap);
}

$siteHost = dw_fx_bare_host(dw_home_url($conn));
$faqByPost = [];
foreach (array_chunk($ids, 500) as $chunk) {
    $faqByPost += dw_fx_faq_fields($conn, $chunk);
}

set_time_limit(0);

// Read every field once, unlocked, in batches, and run the rule in memory: only fields it would
// change go through the locked write (which re-reads and re-applies, so a field edited meanwhile
// is handled on its current value). A dry run never opens a transaction.
$contentByPost = [];
$titleByPost = [];
foreach (array_chunk($ids, 200) as $chunk) {
    $ph = implode(',', array_fill(0, count($chunk), '?'));
    $stmt = $conn->prepare("SELECT ID, post_title, post_content FROM wp_posts WHERE ID IN ($ph)");
    dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $chunk));
    $stmt->execute();
    foreach ($stmt->get_result()->fetch_all(MYSQLI_ASSOC) as $row) {
        $contentByPost[(int) $row['ID']] = (string) $row['post_content'];
        $titleByPost[(int) $row['ID']] = html_entity_decode((string) $row['post_title'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
}

$totals = ['posts' => 0, 'fields' => 0, 'internal' => 0, 'external' => 0];
$items = [];
$errors = [];
$journalIds = [];
$activityChanges = [];
foreach ($ids as $postId) {
    $fields = [['content', null, $contentByPost[$postId] ?? '']];
    foreach ($faqByPost[$postId] ?? [] as $row) {
        $fields[] = ['faq', $row['meta_key'], (string) $row['meta_value']];
    }
    $postInternal = 0;
    $postExternal = 0;
    $title = $titleByPost[$postId] ?? '';
    foreach ($fields as [$source, $metaKey, $value]) {
        if (stripos($value, '<a') === false) {
            continue;
        }
        [, $in, $ex] = dw_fx_target_rule($value, $siteHost);
        if (!$in && !$ex) {
            continue;
        }
        $r = $dryRun
            ? ['status' => 'preview', 'internal' => $in, 'external' => $ex]
            : dw_fx_apply_target_rule($conn, $postId, $source, $metaKey, $siteHost, $ACTIVE_DB, false);
        if ($r['status'] === 'error') {
            $errors[] = "#$postId: " . $r['message'];
            continue;
        }
        if (!in_array($r['status'], ['preview', 'updated'], true)) {
            continue;
        }
        $title = $r['title'] ?? $title;
        $postInternal += $r['internal'];
        $postExternal += $r['external'];
        $totals['fields']++;
        if ($r['status'] === 'updated') {
            $journalIds[] = $r['journal_id'];
            $activityChanges[] = [
                'kind'    => 'link',
                'post_id' => $postId,
                'field'   => $source === 'faq' ? (string) $metaKey : 'post_content',
                'before'  => 'link targets before the new-tab rule',
                'after'   => "{$r['internal']} internal -> same tab, {$r['external']} external -> new tab",
                'count'   => $r['internal'] + $r['external'],
            ];
        }
    }
    if ($postInternal + $postExternal) {
        $totals['posts']++;
        $totals['internal'] += $postInternal;
        $totals['external'] += $postExternal;
        $items[] = ['post_id' => $postId, 'title' => $title, 'internal' => $postInternal, 'external' => $postExternal];
    }
}

$activityId = null;
if (!$dryRun && $journalIds) {
    $activityId = md_activity_log($ACTIVE_DB, [
        'source'  => 'fixer',
        'action'  => 'link_target',
        'summary' => 'Links: new-tab rule on ' . $totals['posts'] . ' post' . ($totals['posts'] === 1 ? '' : 's')
            . " ({$totals['internal']} internal -> same tab, {$totals['external']} external -> new tab)",
        'changes' => $activityChanges,
        'ref'     => ['journal' => 'fixer', 'id' => $journalIds[0], 'ids' => $journalIds],
    ]);
}

$checked = count($ids);
$msg = $dryRun
    ? ($totals['posts'] ? "{$totals['posts']} of $checked posts need changes" : "All $checked posts already follow the rule")
    : "Updated {$totals['posts']} posts";
json_out(!$errors || $totals['posts'] > 0, $errors && !$totals['posts'] ? implode('; ', array_slice($errors, 0, 5)) : $msg, $totals + [
    'checked'  => $checked,
    'items'    => $items,
    'errors'   => $errors,
    'capped'   => $capped,
] + ($activityId ? ['activity_id' => $activityId] : []));
