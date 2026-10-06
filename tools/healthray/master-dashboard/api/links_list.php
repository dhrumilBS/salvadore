<?php
/**
 * GET api/links_list.php - Links & UTM tab: filtered post list, each row
 * hydrated exactly like a Content-tab row (real permalink, not guid) plus its
 * fully-extracted link list (lib/link_extractor.php). Filters that exist as
 * real DB columns (post_type, status, search, publish/modified date range)
 * go through the same dw_parse_input()/dw_build_where() as the Content tab;
 * everything derived from the extracted links (UTM/domain/live status) is
 * sliced client-side, since the client already has every returned post's
 * full link list.
 */
require __DIR__ . '/bootstrap.php';

$f = dw_parse_input($_GET, dw_known_post_types($conn));

$cap  = dw_links_row_cap();
$rows = dw_fetch_posts_with_content($conn, $f, $cap);
// Under the cap the fetch already is the full result - skip a round trip (~0.2s per query to a remote site).
$total = count($rows) < $cap ? count($rows) : dw_count_posts($conn, $f);

$home     = dw_home_url($conn);
$homeHost = parse_url($home, PHP_URL_HOST);

$data = [];
foreach ($rows as $r) {
    $links = dw_extract_links($r['post_content'], $r['permalink'] ?: $home, $homeHost);
    $data[] = [
        'id'         => $r['id'],
        'post_type'  => $r['post_type'],
        'title'      => $r['title'],
        'slug'       => $r['slug'],
        'permalink'  => $r['permalink'],
        'status'     => $r['status'],
        'post_date'  => $r['publish_date'],
        'links'      => $links,
        'link_count' => count($links),
        'utm_count'  => count(array_filter($links, fn($l) => $l['is_utm'])),
    ];
}

json_out(true, 'Posts loaded', [
    'data'     => $data,
    'total'    => $total,
    'returned' => count($data),
    'cap'      => $cap,
    'capped'   => $total > count($data),
    'filters'  => $f,
]);
