<?php
/**
 * GET api/fixer_list.php - Link Fixer tab: one page of posts (paged by post,
 * not by link) and every <a href> found in each post's content and in its ACF
 * FAQ answer fields, each link carrying the raw href a write has to match.
 *
 * Params: post_type (comma list, or "any"), status, search (title/slug/
 * content/Yoast meta, same as every tab), link (only posts - and only links -
 * whose URL contains this text, across the whole site), order, page, per_page.
 */
require __DIR__ . '/bootstrap.php';

// Every row's post_content crosses the wire as extracted links - compress big pages.
if (!ini_get('zlib.output_compression') && extension_loaded('zlib')) {
    ob_start('ob_gzhandler');
}

$f = dw_parse_input($_GET, dw_known_post_types($conn));

$page    = max(1, (int) ($_GET['page'] ?? 1));
$perPage = min(500, max(1, (int) ($_GET['per_page'] ?? 50)));
$needle  = trim((string) ($_GET['link'] ?? ''));

$orders = [
    'id_asc'        => 'p.ID ASC',
    'id_desc'       => 'p.ID DESC',
    'date_desc'     => 'p.post_date DESC, p.ID DESC',
    'modified_desc' => 'p.post_modified DESC, p.ID DESC',
];
$orderKey = array_key_exists($_GET['order'] ?? '', $orders) ? $_GET['order'] : 'id_asc';

$home     = dw_home_url($conn);
$variants = $needle !== '' ? dw_fx_needle_variants($needle, $home) : [];

[$where, $params] = dw_build_where($f);
if ($variants) {
    [$linkSql, $linkParams] = dw_fx_link_search_where($variants);
    $where .= ' AND ' . $linkSql;
    $params = array_merge($params, $linkParams);
}

$stmt = $conn->prepare("SELECT COUNT(*) AS total FROM wp_posts p WHERE $where");
dw_stmt_bind($stmt, $params);
$stmt->execute();
$totalPosts = (int) ($stmt->get_result()->fetch_assoc()['total'] ?? 0);
$totalPages = max(1, (int) ceil($totalPosts / $perPage));
$page = min($page, $totalPages);

$stmt = $conn->prepare("SELECT p.ID AS id, p.post_type, p.post_title AS title, p.post_name AS slug,
        p.post_status AS status, p.post_date, p.post_parent, p.post_content
    FROM wp_posts p
    WHERE $where
    ORDER BY {$orders[$orderKey]}
    LIMIT ? OFFSET ?");
$params[] = ['type' => 'i', 'value' => $perPage];
$params[] = ['type' => 'i', 'value' => ($page - 1) * $perPage];
dw_stmt_bind($stmt, $params);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$siteHost = dw_fx_bare_host($home);
$res      = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
$siteUrl  = rtrim((string) (($res ? $res->fetch_assoc() : null)['option_value'] ?? $home), '/');

$permalinks = array_column(dw_hydrate_batch($conn, $rows), 'permalink', 'id');
$faqByPost  = dw_fx_faq_fields($conn, array_column($rows, 'id'));
$variantsLc = array_map('mb_strtolower', $variants);
$matchesNeedle = function ($l) use ($variantsLc) {
    foreach ($variantsLc as $v) {
        if (str_contains(mb_strtolower($l['url']), $v) || str_contains(mb_strtolower($l['href']), $v)) {
            return true;
        }
    }
    return false;
};

$links = [];
foreach ($rows as $r) {
    $id    = (int) $r['id'];
    $base  = $permalinks[$id] ?? $home;
    $title = html_entity_decode((string) $r['title'], ENT_QUOTES | ENT_HTML5, 'UTF-8'); // WP stores "&amp;" in titles
    $sources = [['content', null, $r['post_content']]];
    foreach ($faqByPost[$id] ?? [] as $m) {
        $sources[] = ['faq', $m['meta_key'], $m['meta_value']];
    }

    foreach ($sources as [$source, $metaKey, $html]) {
        $found = dw_fx_extract_links($html, $base, $siteHost);
        if ($variants) {
            $found = array_values(array_filter($found, $matchesNeedle));
        }
        // Every occurrence is its own row; a write still affects every <a> with
        // that exact href in the field, so tell the UI how many there are.
        $repeats = array_count_values(array_column($found, 'href'));
        foreach ($found as $l) {
            $links[] = $l + [
                'post_id'          => $id,
                'post_title'       => $title,
                'post_type'        => $r['post_type'],
                'post_status'      => $r['status'],
                'permalink'        => $permalinks[$id] ?? '',
                'source'           => $source,
                'meta_key'         => $metaKey,
                'occurrence_count' => $repeats[$l['href']],
            ];
        }
    }
}

json_out(true, 'Links loaded', [
    'home'        => $home,
    'admin_url'   => $siteUrl . '/wp-admin/',
    'total_posts' => $totalPosts,
    'post_count'  => count($rows),
    'page'        => $page,
    'per_page'    => $perPage,
    'total_pages' => $totalPages,
    'links'       => $links,
    'filters'     => $f + ['link' => $needle, 'order' => $orderKey],
]);
