<?php
require __DIR__ . '/bootstrap.php';

$knownPostTypes = dw_known_post_types($conn);
$f = dw_parse_input($_GET, $knownPostTypes);

$page    = max(1, (int) ($_GET['page'] ?? 1));
$perPage = (int) ($_GET['per_page'] ?? 20);
if ($perPage < 1) {
    $perPage = 20;
}
if ($perPage > 1000) {
    $perPage = 1000;
}
$offset = ($page - 1) * $perPage;

$total = dw_count_posts($conn, $f);
$rows  = dw_fetch_posts_page($conn, $f, $perPage, $offset);
$data  = dw_hydrate_batch($conn, $rows);

json_out(true, 'Posts loaded', [
    'data'        => $data,
    'total'       => $total,
    'page'        => $page,
    'per_page'    => $perPage,
    'total_pages' => $total > 0 ? (int) ceil($total / $perPage) : 1,
    'filters'     => $f,
]);
