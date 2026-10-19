<?php
/**
 * GET api/canonical_report.php - canonical URLs that redirect / are gone / point at a retired post.
 *
 *   paths=<newline- or comma-separated URLs/paths>  (GET or POST) only canonicals pointing at these (the
 *                                                  "you just retired a URL" prompts); omit = whole site
 *   unmatched=0      leave out canonicals that match no post/redirect (archives, static files...)
 *   format=csv       download the report (every row, cells through dw_csv_write())
 *
 * JSON: {success, home, scanned, rows:[...see dw_canonical_audit()], counts:{kind: n}}
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/canonical.php';

// paths may also come as POST (read-only either way) - a bulk trash can name more URLs than fit in a query string.
$rawPaths = $_POST['paths'] ?? $_GET['paths'] ?? null;
$paths = null;
if ($rawPaths !== null) {
    $paths = array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', (string) $rawPaths)), 'strlen'));
    if (count($paths) > 1000) {
        json_out(false, 'At most 1000 URLs per check.');
    }
}
$includeUnmatched = ($_GET['unmatched'] ?? '1') !== '0';

$audit = dw_canonical_audit($conn, $paths, $includeUnmatched);
foreach ($audit['rows'] as &$r) {
    $r['reason'] = dw_canonical_reason($r);
}
unset($r);

if (($_GET['format'] ?? '') === 'csv') {
    $filename = 'canonical-issues-' . preg_replace('/[^a-z0-9_-]+/i', '-', $ACTIVE_DB) . '-' . date('Y-m-d_His') . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    dw_csv_write($out, ['Post ID', 'Title', 'Type', 'Status', 'Post URL', 'Canonical URL', 'Issue', 'Details', 'Suggested canonical']);
    foreach ($audit['rows'] as $r) {
        dw_csv_write($out, [
            $r['id'], $r['title'], $r['post_type'], $r['status'], $r['permalink'], $r['canonical'],
            $r['kind_label'], $r['reason'], $r['suggested'] !== '' ? $r['suggested'] : ($r['kind'] === 'unmatched' ? '' : '(remove canonical)'),
        ]);
    }
    fclose($out);
    exit;
}

$counts = array_fill_keys(array_keys(dw_canonical_kinds()), 0);
foreach ($audit['rows'] as $r) {
    $counts[$r['kind']]++;
}

json_out(true, count($audit['rows']) . ' canonical issue(s)', [
    'home'    => $audit['home'],
    'scanned' => $audit['scanned'],
    'rows'    => $audit['rows'],
    'counts'  => $counts,
    'kinds'   => dw_canonical_kinds(),
]);
