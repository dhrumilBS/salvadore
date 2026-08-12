<?php
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirects.php';

$f = dw_parse_redirect_input($_GET);

$rows = dw_load_yoast_redirects($conn);
$rows = dw_filter_redirects($rows, $f);
$rows = dw_attach_redirect_matches($conn, $rows);
$rows = dw_apply_redirect_match_filter($rows, $f['match']);
$rows = dw_sort_redirects($rows, $f['sort'], $f['dir']);

$home = dw_home_url($conn);

/*
 * Optional live link-status filter on the redirect's origin URL (mirrors
 * export.php's link-status filter for the main content export) - opt-in
 * since it checks every surviving row's URL for real.
 */
$wantedCodes  = array_values(array_filter(array_map('trim', explode(',', (string) ($_GET['link_status'] ?? '')))));
$wantOther    = in_array('other', $wantedCodes, true);
$wantedCodes  = array_values(array_diff($wantedCodes, ['other']));
$linkStatusOn = (bool) $wantedCodes || $wantOther;

if ($linkStatusOn) {
    require __DIR__ . '/lib/link_checker.php';
    set_time_limit(0);

    $plainRows  = array_filter($rows, fn($r) => $r['format'] === 'plain' && $r['origin'] !== '');
    $urlById    = [];
    foreach ($plainRows as $r) {
        $urlById[$r['id']] = $home . '/' . $r['origin'] . '/';
    }
    $statusByUrl = $urlById ? dw_check_urls_concurrent(array_values($urlById)) : [];

    $rows = array_values(array_filter($rows, function ($r) use ($urlById, $statusByUrl, $wantedCodes, $wantOther) {
        $url  = $urlById[$r['id']] ?? null;
        $code = $url !== null ? ($statusByUrl[$url] ?? 0) : 0;
        return dw_link_status_matches($code, $wantedCodes, $wantOther);
    }));
}

$stamp    = date('Y-m-d_His');
$filename = "redirects-export-{$stamp}.csv";

header('Content-Type: text/csv; charset=utf-8');
header("Content-Disposition: attachment; filename=\"{$filename}\"");

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF");
fputcsv($out, [
    'Origin', 'Origin URL', 'Type', 'Destination', 'Destination URL', 'Format',
    'Origin Post ID', 'Origin Post Title', 'Origin Post Type', 'Origin Post Status',
    'Destination Post ID', 'Destination Post Title', 'Destination Post Type', 'Destination Post Status',
]);

foreach ($rows as $r) {
    $originUrl = $r['format'] === 'plain' && $r['origin'] !== '' ? $home . '/' . $r['origin'] . '/' : '';
    $destUrl   = $r['format'] === 'plain' && $r['url'] !== '' ? $home . '/' . $r['url'] . '/' : '';
    $op        = $r['origin_post'];
    $dp        = $r['dest_post'];

    fputcsv($out, [
        $r['origin'], $originUrl, $r['type'], $r['url'], $destUrl, $r['format'],
        $op['id'] ?? '', $op['title'] ?? '', $op['post_type'] ?? '', $op['status'] ?? '',
        $dp['id'] ?? '', $dp['title'] ?? '', $dp['post_type'] ?? '', $dp['status'] ?? '',
    ]);
}
fclose($out);
