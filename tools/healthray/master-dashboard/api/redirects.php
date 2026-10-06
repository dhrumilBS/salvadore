<?php
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirects.php';

$f = dw_parse_redirect_input($_GET);

$rows = dw_load_yoast_redirects($conn);
$rows = dw_filter_redirects($rows, $f);
$rows = dw_attach_redirect_matches($conn, $rows);
$rows = dw_apply_redirect_match_filter($rows, $f['match']);
$rows = dw_sort_redirects($rows, $f['sort'], $f['dir']);

$total    = count($rows);
$page     = max(1, (int) ($_GET['page'] ?? 1));
$perPage  = (int) ($_GET['per_page'] ?? 20);
if ($perPage < 1) {
    $perPage = 20;
}
if ($perPage > 1000) {
    $perPage = 1000;
}
$totalPages = $total > 0 ? (int) ceil($total / $perPage) : 1;
$page       = min($page, $totalPages);
$offset     = ($page - 1) * $perPage;

$pageRows = array_slice($rows, $offset, $perPage);

// Full clickable/checkable URLs, computed server-side like the main table's permalink.
$home = dw_home_url($conn);
foreach ($pageRows as &$r) {
    $r['origin_url'] = ($r['format'] === 'plain' && $r['origin'] !== '') ? $home . '/' . $r['origin'] . '/' : '';
    $r['dest_url']   = ($r['format'] === 'plain' && $r['url'] !== '') ? $home . '/' . $r['url'] . '/' : '';
}
unset($r);

json_out(true, 'Redirects loaded', [
    'data'        => $pageRows,
    'total'       => $total,
    'page'        => $page,
    'per_page'    => $perPage,
    'total_pages' => $totalPages,
]);
