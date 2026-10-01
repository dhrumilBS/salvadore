<?php
/**
 * GET api/list_posts.php — filtered post list, each row hydrated with its
 * fully-extracted link list (see lib/link_extractor.php). Filters that
 * exist as real DB columns (post_type, status, search, publish date range)
 * are pushed down to SQL; everything derived from the extracted links
 * (UTM/domain/live status) is left for the client to slice, since the
 * client already has the full link list for every returned post.
 */
require __DIR__ . '/bootstrap.php';

$knownPostTypes = array_column(lc_known_post_types($conn, $prefix), 'type');
$f = lc_parse_input($_GET, $knownPostTypes);

$cap   = lc_row_cap();
$total = lc_count_posts($conn, $prefix, $f);
$raw   = lc_fetch_posts_raw($conn, $prefix, $f, $cap);

$home     = lc_home_url($conn, $prefix);
$homeHost = parse_url($home, PHP_URL_HOST);

$data = [];
foreach ($raw as $r) {
    $links = lc_extract_links($r['post_content'], $r['guid'] ?: $home, $homeHost);
    $data[] = [
        'id'         => (int) $r['ID'],
        'post_type'  => $r['post_type'],
        'title'      => $r['post_title'],
        'slug'       => $r['post_name'],
        'guid'       => $r['guid'],
        'status'     => $r['post_status'],
        'post_date'  => $r['post_date'],
        'links'      => $links,
        'link_count' => count($links),
        'utm_count'  => count(array_filter($links, fn($l) => $l['is_utm'])),
    ];
}

json_out(true, 'Posts loaded', [
    'data'            => $data,
    'total'           => $total,
    'returned'        => count($data),
    'cap'             => $cap,
    'capped'          => $total > count($data),
    'site_key'        => $DB_KEY,
    'site_label'      => $DB_CFG['label'] ?? $DB_KEY,
    'known_post_types' => lc_known_post_types($conn, $prefix),
    'filters'         => $f,
]);
