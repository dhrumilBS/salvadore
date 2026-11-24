<?php
/**
 * GET api/recent_changes.php - Recent changes view: posts modified in the last `days` (1-90, default 7)
 * with how each was changed (dashboard / editor / unknown) and bulk changes (DW_RC_BULK_MIN+ posts in one
 * minute). See lib/recent_changes.php. Read-only.
 *
 *   format=csv   every change as CSV
 *
 * Each batch also gets `also_on`: other configured sites with 5+ posts modified in that same minute -
 * one minute on several sites at once points at a server-level job (a script, a cron, a deploy), not a person.
 *
 * JSON: {success, days, since_gmt, capped, changes:[...], batches:[...], uploads, home, admin_url}
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/recent_changes.php';

if (!ini_get('zlib.output_compression') && extension_loaded('zlib') && ($_GET['format'] ?? '') !== 'csv') {
    ob_start('ob_gzhandler');
}

$days = (int) ($_GET['days'] ?? 7);
$rc = dw_recent_changes($conn, $ACTIVE_DB, $days ?: 7);

// Same minute on another site? One query per other site, only for this site's batch minutes.
if ($rc['batches']) {
    $minutes = array_column($rc['batches'], 'minute_gmt');
    foreach ($DATABASES as $key => $cfg) {
        if ($key === $ACTIVE_DB) {
            continue;
        }
        $isLocal = in_array($cfg['host'], ['127.0.0.1', 'localhost', '::1'], true);
        $c = mysqli_init();
        $c->options(MYSQLI_OPT_CONNECT_TIMEOUT, 8);
        if (!@$c->real_connect($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name'], $cfg['port'], null, $isLocal ? 0 : MYSQLI_CLIENT_COMPRESS)) {
            continue;
        }
        $ph = implode(',', array_fill(0, count($minutes), '?'));
        $stmt = $c->prepare("SELECT DATE_FORMAT(post_modified_gmt, '%Y-%m-%d %H:%i') AS m, COUNT(*) AS n FROM wp_posts
            WHERE post_type NOT IN ('revision', 'attachment', 'nav_menu_item') AND DATE_FORMAT(post_modified_gmt, '%Y-%m-%d %H:%i') IN ($ph)
            GROUP BY m HAVING n >= 5");
        $stmt->bind_param(str_repeat('s', count($minutes)), ...$minutes);
        $stmt->execute();
        $hits = array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), 'n', 'm');
        foreach ($rc['batches'] as &$b) {
            if (isset($hits[$b['minute_gmt']])) {
                $b['also_on'][] = ['site' => (string) ($cfg['label'] ?? $key), 'count' => (int) $hits[$b['minute_gmt']]];
            }
        }
        unset($b);
        $c->close();
    }
}

if (($_GET['format'] ?? '') === 'csv') {
    $filename = 'recent-changes-' . preg_replace('/[^a-z0-9_-]+/i', '-', $ACTIVE_DB) . '-' . $rc['days'] . 'd-' . date('Y-m-d_His') . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    $how = ['dashboard' => 'This dashboard', 'editor' => 'WP editor (revision saved)', 'unknown' => 'No revision - plugin / import / script?'];
    dw_csv_write($out, ['Modified (site time)', 'Modified (UTC)', 'Post ID', 'Title', 'Type', 'Status', 'URL', 'How', 'Saved by', 'Last WP editor', 'Bulk change (UTC minute)', 'Dashboard entry']);
    foreach ($rc['changes'] as $r) {
        dw_csv_write($out, [$r['modified'], $r['modified_gmt'], $r['id'], $r['title'], $r['post_type'], $r['status'], $r['permalink'],
            $how[$r['via']], $r['who'], $r['last_editor'], $r['batch'], $r['note']]);
    }
    fclose($out);
    exit;
}

$res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
$siteUrl = rtrim((string) (($res ? $res->fetch_assoc() : null)['option_value'] ?? $rc['home']), '/');
json_out(true, count($rc['changes']) . ' change(s)', $rc + ['admin_url' => $siteUrl . '/wp-admin/']);
