<?php
/**
 * GET api/internal_links.php - Internal links tab: inbound links per published post (orphans) and
 * internal links that point at retired URLs (410 / redirect / trashed post), from lib/internal_links.php.
 *
 *   format=csv&mode=posts   every published post with its inbound / outbound counts
 *   format=csv&mode=links   every link to a retired URL
 *
 * JSON: {success, home, scanned, capped, posts:[...], links:[...]}
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/internal_links.php';

// Every post's link list crosses the wire - compress it.
if (!ini_get('zlib.output_compression') && extension_loaded('zlib') && ($_GET['format'] ?? '') !== 'csv') {
    ob_start('ob_gzhandler');
}
set_time_limit(120);

$audit = dw_internal_links_audit($conn);

if (($_GET['format'] ?? '') === 'csv') {
    $mode = ($_GET['mode'] ?? '') === 'links' ? 'links' : 'posts';
    $filename = 'internal-' . ($mode === 'links' ? 'retired-links' : 'inbound') . '-' . preg_replace('/[^a-z0-9_-]+/i', '-', $ACTIVE_DB) . '-' . date('Y-m-d_His') . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    if ($mode === 'posts') {
        $titles = array_column($audit['posts'], 'title', 'id');
        dw_csv_write($out, ['Post ID', 'Title', 'Type', 'URL', 'Indexable', 'Inbound posts', 'Inbound links', 'Links out (internal)', 'Orphan', 'Linked from']);
        foreach ($audit['posts'] as $p) {
            dw_csv_write($out, [
                $p['id'], $p['title'], $p['post_type'], $p['permalink'], $p['indexable'] ? 'yes' : 'no (noindex)',
                $p['inbound'], $p['inbound_links'], $p['outbound'], $p['inbound'] === 0 && !$p['is_front'] ? ($p['in_menu'] ? 'in menu only' : 'yes') : '',
                implode(' | ', array_map(fn($id) => "#$id " . ($titles[$id] ?? ''), $p['sources'])),
            ]);
        }
    } else {
        $kind = ['gone' => '410 Gone', 'redirect' => 'Redirects', 'not_live' => 'Trashed / unpublished post (404)'];
        dw_csv_write($out, ['Source post ID', 'Source title', 'Source URL', 'Field', 'Anchor text', 'Link URL', 'Times', 'Issue', 'Rule', 'Ends at']);
        foreach ($audit['links'] as $l) {
            dw_csv_write($out, [
                $l['source_id'], $l['source_title'], $l['source_permalink'], $l['source'] === 'faq' ? $l['meta_key'] : ($l['source'] === 'elementor' ? 'Elementor layout' : 'content'),
                $l['anchor'], $l['url'], $l['count'], $kind[$l['kind']],
                $l['rule_type'] ? $l['rule_type'] . ($l['rule_url'] !== '' ? ' -> /' . $l['rule_url'] . '/' : '') : $l['target_title'],
                $l['final'],
            ]);
        }
    }
    fclose($out);
    exit;
}

$res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
$siteUrl = rtrim((string) (($res ? $res->fetch_assoc() : null)['option_value'] ?? $audit['home']), '/');

json_out(true, count($audit['links']) . ' link(s) to retired URLs', $audit + ['admin_url' => $siteUrl . '/wp-admin/']);
