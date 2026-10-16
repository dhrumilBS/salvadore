<?php
/**
 * GET api/finder_post.php?id=N - everything the post detail drawer shows about
 * one post (read-only): core fields + real permalink + wp-admin edit URL,
 * Yoast SEO fields, other posts sharing its focus keyword, the links in its
 * content, redirect rules that fire FROM its URL (conflict while the post is
 * live) or point TO it, revision count, menu order + parent.
 *
 * All statements are folded into one SELECT (one round trip, fd_batch) - see lib/finder.php.
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/redirects.php';
require __DIR__ . '/lib/finder.php';

$t0 = microtime(true);
$id = (int) (is_string($_GET['id'] ?? null) ? $_GET['id'] : 0);
if ($id <= 0) {
    http_response_code(400);
    json_out(false, 'Missing post ID');
}

$excluded = fd_excluded_types_sql($conn);
$meta = fn($key, $alias) => "(SELECT m.meta_value FROM wp_postmeta m WHERE m.post_id = p.ID AND m.meta_key = '$key' LIMIT 1) AS $alias";

$postSql = "SELECT p.ID AS id, p.post_type, p.post_title AS title, p.post_name AS slug, p.post_status AS status,
        CAST(p.post_date AS CHAR) AS post_date, CAST(p.post_modified AS CHAR) AS post_modified, p.post_parent, p.menu_order, (p.post_password <> '') AS has_password,
        u.display_name AS author_name,
        a1.post_title AS parent_title, a1.post_type AS parent_type, a1.post_status AS parent_status,
        " . fd_ancestor_cols() . ",
        " . fd_category_cols('p') . ",
        " . $meta('_yoast_wpseo_title', 'seo_title') . ",
        " . $meta('_yoast_wpseo_metadesc', 'seo_desc') . ",
        " . $meta('_yoast_wpseo_focuskw', 'focus_kw') . ",
        " . $meta('_yoast_wpseo_canonical', 'seo_canonical') . ",
        " . $meta('_yoast_wpseo_meta-robots-noindex', 'seo_noindex') . ",
        (SELECT COUNT(*) FROM wp_posts r WHERE r.post_parent = p.ID AND r.post_type = 'revision') AS revision_count,
        (SELECT CAST(MAX(r.post_modified) AS CHAR) FROM wp_posts r WHERE r.post_parent = p.ID AND r.post_type = 'revision') AS revision_last,
        (SELECT COUNT(*) FROM wp_posts c WHERE c.post_parent = p.ID AND c.post_type NOT IN ($excluded)
            AND c.post_status NOT IN ('trash', 'auto-draft', 'inherit')) AS child_count
    FROM wp_posts p
    LEFT JOIN wp_users u ON u.ID = p.post_author
    " . fd_ancestor_joins('p') . "
    WHERE p.ID = $id";

$termsSql = "SELECT t.term_id, t.name, tt.taxonomy FROM wp_term_relationships tr
    INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy IN ('category', 'post_tag')
    INNER JOIN wp_terms t ON t.term_id = tt.term_id
    WHERE tr.object_id = $id";

$optNames = ['home', 'siteurl', 'permalink_structure', 'page_on_front', 'page_for_posts', DW_OPT_REDIRECT_REGEX];
$optSql = 'SELECT option_name, option_value FROM wp_options WHERE option_name IN ('
    . implode(',', array_map(fn($n) => fd_q($conn, $n), $optNames)) . ')';

/*
 * The two plain-redirect options are tens of KB (sent raw, not JSON-escaped). On a fresh connection a
 * response that big plus post_content needs a second TCP round trip (slow
 * start, +220 ms on Botphonic), so they are only sent when they contain this
 * post's slug at all - a rule whose origin or destination is this post's path
 * must. When "base" is skipped, the regex rules still come from the (small)
 * export-regex option via the same fallback dw_redirect_load() uses.
 */
$baseQ  = fd_q($conn, DW_OPT_REDIRECT_BASE);
$plainQ = fd_q($conn, DW_OPT_REDIRECT_PLAIN);
$slugExpr = "(SELECT REGEXP_REPLACE(s.post_name, '__trashed(-[0-9]+)?$', '') FROM wp_posts s WHERE s.ID = $id)";
// export-plain duplicates base's plain rules - only needed when base itself is empty (dw_redirect_load() fallback).
$baseFilled = "EXISTS (SELECT 1 FROM wp_options b WHERE b.option_name = $baseQ AND b.option_value NOT IN ('', 'a:0:{}'))";
$optBaseSql = "SELECT CASE WHEN LOCATE($slugExpr, option_value) = 0 THEN NULL ELSE option_value END
    FROM wp_options WHERE option_name = $baseQ LIMIT 1";
$optPlainSql = "SELECT CASE WHEN LOCATE($slugExpr, option_value) = 0 OR $baseFilled THEN NULL ELSE option_value END
    FROM wp_options WHERE option_name = $plainQ LIMIT 1";

// Same keyword key as the Focus Keywords tab (trim + lower-case), across every real type, trash excluded.
$kwLimit = 50;
$kwSql = "SELECT DISTINCT o.ID AS id, o.post_title AS title, o.post_type, o.post_status AS status,
        (o.post_status = 'publish') AS is_pub, CAST(o.post_modified AS CHAR) AS modified
    FROM wp_postmeta km
    INNER JOIN wp_posts o ON o.ID = km.post_id
    WHERE km.meta_key = '_yoast_wpseo_focuskw'
        AND LOWER(TRIM(km.meta_value)) = (SELECT LOWER(TRIM(m.meta_value)) FROM wp_postmeta m
            WHERE m.post_id = $id AND m.meta_key = '_yoast_wpseo_focuskw' AND TRIM(m.meta_value) <> '' LIMIT 1)
        AND o.ID <> $id
        AND o.post_type NOT IN ($excluded)
        AND o.post_status NOT IN ('trash', 'auto-draft', 'inherit')
    ORDER BY is_pub DESC, modified DESC
    LIMIT " . ($kwLimit + 1);

try {
    $res = fd_batch($conn, [
        'post'  => [$postSql, array_merge(['id', 'post_type', 'title', 'slug', 'status', 'post_date', 'post_modified',
            'post_parent', 'menu_order', 'has_password', 'author_name', 'parent_title', 'parent_type',
            'parent_status', 'primary_cat', 'min_cat', 'seo_title', 'seo_desc', 'focus_kw', 'seo_canonical', 'seo_noindex',
            'revision_count', 'revision_last', 'child_count'], fd_ancestor_names())],
        'terms' => [$termsSql, ['term_id', 'name', 'taxonomy']],
        'opts'  => [$optSql, ['option_name', 'option_value']],
        'kw'    => [$kwSql, ['id', 'title', 'post_type', 'status', 'is_pub', 'modified']],
        'cats'  => [fd_category_terms_sql(), ['term_id', 'slug', 'parent']],
    ], [
        'content'   => "SELECT post_content FROM wp_posts WHERE ID = $id",
        'opt_base'  => $optBaseSql,
        'opt_plain' => $optPlainSql,
    ]);
    $postRows = $res['post'];
    $termRows = fd_sort_rows($res['terms'], ['taxonomy' => 'asc', 'name' => 'asc']);
    $optRows  = $res['opts'];
    $kwRows   = fd_sort_rows($res['kw'], ['is_pub' => 'desc', 'modified' => 'desc']);
    $catTerms = $res['cats'];
} catch (Throwable $e) {
    error_log('finder_post: ' . $e->getMessage());
    http_response_code(500);
    json_out(false, 'Could not load this post');
}

$p = $postRows[0] ?? null;
if (!$p) {
    http_response_code(404);
    json_out(false, "Post #$id was not found on this site");
}
$dbMs = round((microtime(true) - $t0) * 1000);

$opts      = fd_options_map($optRows);
$opts[DW_OPT_REDIRECT_BASE]  = $res['opt_base'];
$opts[DW_OPT_REDIRECT_PLAIN] = $res['opt_plain'];
$home      = rtrim((string) ($opts['home'] ?? ''), '/');
$siteUrl   = rtrim((string) ($opts['siteurl'] ?? $home), '/');
$structure = fd_structure($opts['permalink_structure'] ?? '');
$path      = fd_row_path($p, $structure, fd_category_path_map($catTerms), dw_post_type_bases($conn));
// The static front page is served at the site root, not at its own slug (path stays the slug path for redirect matching).
$isFront   = (int) ($opts['page_on_front'] ?? 0) === (int) $p['id'];
$permalink = $home . '/' . ($path !== '' && !$isFront ? $path . '/' : '');
$isLive    = in_array($p['status'], dw_live_statuses(), true);
$decode    = fn($s) => html_entity_decode((string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8');

/* ── categories / tags ── */
$categories = [];
$tags = [];
foreach ($termRows as $t) {
    if ($t['taxonomy'] === 'category') {
        $categories[] = $decode($t['name']);
    } else {
        $tags[] = $decode($t['name']);
    }
}

/* ── links in content (the same extractor as the Links tab) ── */
$homeHost = (string) parse_url($home, PHP_URL_HOST);
$linkCap = 300;
$allLinks = dw_extract_links((string) $res['content'], $permalink ?: $home, $homeHost);
$internal = count(array_filter($allLinks, fn($l) => $l['is_internal']));
$links = array_map(fn($l) => [
    'url'         => $l['url'],
    'anchor'      => $l['anchor'],
    'is_internal' => $l['is_internal'],
    'is_utm'      => $l['is_utm'],
], array_slice($allLinks, 0, $linkCap));

/* ── redirects: from this URL (origin) and to this URL (destination) ── */
$base = dw_redirect_normalize_base(dw_redirect_unserialize($opts[DW_OPT_REDIRECT_BASE] ?? ''));
$rules = $base['rules'];
if (!$rules) { // same fallback as dw_redirect_load(): only the export maps exist
    foreach (['plain' => DW_OPT_REDIRECT_PLAIN, 'regex' => DW_OPT_REDIRECT_REGEX] as $format => $optName) {
        foreach (dw_redirect_unserialize($opts[$optName] ?? '') as $origin => $entry) {
            if (is_array($entry) && (string) $origin !== '') {
                $rules[] = ['origin' => (string) $origin, 'url' => (string) ($entry['url'] ?? ''), 'type' => (int) ($entry['type'] ?? 301), 'format' => $format];
            }
        }
    }
}
$pathKey = strtolower($path);
$redirOrigin = [];
$redirDest = [];
$redirRegex = [];
$ruleOut = function (array $r) use ($home) {
    $origin = trim((string) $r['origin'], '/');
    $url = (string) $r['url'];
    $isAbs = (bool) preg_match('#^https?://#i', $url);
    return [
        'origin'     => $origin,
        'url'        => $isAbs ? $url : trim($url, '/'),
        'type'       => (int) $r['type'],
        'format'     => $r['format'],
        'origin_url' => $r['format'] === 'plain' && $origin !== '' ? $home . '/' . $origin . '/' : '',
        'dest_url'   => $url === '' ? '' : ($isAbs ? $url : $home . '/' . trim($url, '/') . '/'),
    ];
};
if ($pathKey !== '') {
    foreach ($rules as $r) {
        if (($r['format'] ?? 'plain') !== 'plain') {
            continue;
        }
        if (fd_path_key($r['origin'], $home) === $pathKey) {
            $redirOrigin[] = $ruleOut($r);
        }
        if ((string) $r['url'] !== '' && fd_path_key($r['url'], $home) === $pathKey) {
            $redirDest[] = $ruleOut($r);
        }
    }
    foreach (dw_redirect_matching_regexes(['rules' => $rules], $path) as $r) {
        $redirRegex[] = $ruleOut($r);
    }
}

/* ── SEO ── */
$focusKw = trim((string) ($p['focus_kw'] ?? ''));
$kwCapped = count($kwRows) > $kwLimit;
$kwOthers = array_map(fn($r) => [
    'id'         => (int) $r['id'],
    'title_text' => $decode($r['title']),
    'post_type'  => $r['post_type'],
    'status'     => $r['status'],
], array_slice($kwRows, 0, $kwLimit));

$seoTitle = (string) ($p['seo_title'] ?? '');
$seoDesc  = (string) ($p['seo_desc'] ?? '');

json_out(true, 'OK', [
    'post' => [
        'id'            => (int) $p['id'],
        'title'         => (string) $p['title'],
        'title_text'    => $decode($p['title']),
        'post_type'     => $p['post_type'],
        'status'        => $p['status'],
        'is_live'       => $isLive,
        'slug'          => (string) $p['slug'],
        'slug_clean'    => dw_clean_slug($p['slug']),
        'slug_trashed'  => dw_slug_is_trashed($p['slug']),
        'path'          => $path,
        'permalink'     => $permalink,
        'edit_url'      => $siteUrl . '/wp-admin/post.php?post=' . (int) $p['id'] . '&action=edit',
        'post_date'     => $p['post_date'],
        'post_modified' => $p['post_modified'],
        'author'        => (string) ($p['author_name'] ?? ''),
        'menu_order'    => (int) $p['menu_order'],
        'parent'        => (int) $p['post_parent'] > 0 ? [
            'id'         => (int) $p['post_parent'],
            'title_text' => $p['parent_title'] !== null ? $decode($p['parent_title']) : '',
            'post_type'  => $p['parent_type'],
            'status'     => $p['parent_status'],
            'missing'    => $p['parent_title'] === null && $p['parent_type'] === null,
        ] : null,
        'child_count'   => (int) $p['child_count'],
        'has_password'  => (bool) $p['has_password'],
        'categories'    => $categories,
        'tags'          => $tags,
        'is_front_page' => $isFront,
        'is_posts_page' => (int) ($opts['page_for_posts'] ?? 0) === (int) $p['id'],
        'internal_type' => in_array($p['post_type'], dw_excluded_post_types(), true),
    ],
    'seo' => [
        'title'            => $seoTitle,
        'title_has_vars'   => fd_has_yoast_vars($seoTitle),
        'description'      => $seoDesc,
        'desc_has_vars'    => fd_has_yoast_vars($seoDesc),
        'focus_kw'         => $focusKw,
        'canonical'        => (string) ($p['seo_canonical'] ?? ''),
        'noindex'          => (string) ($p['seo_noindex'] ?? '') === '1',
        'kw_others'        => $kwOthers,
        'kw_others_capped' => $kwCapped,
    ],
    'links' => [
        'total'    => count($allLinks),
        'internal' => $internal,
        'external' => count($allLinks) - $internal,
        'items'    => $links,
        'capped'   => count($allLinks) > $linkCap,
    ],
    'redirects' => [
        'from'  => $redirOrigin, // rules whose origin is this post's URL - a conflict while the post is live
        'to'    => $redirDest,   // rules that send visitors to this post
        'regex' => $redirRegex,  // regex rules whose pattern covers this post's path
    ],
    'revisions' => [
        'count' => (int) $p['revision_count'],
        'last'  => $p['revision_last'],
    ],
    'home'      => $home,
    'site_url'  => $siteUrl,
    'db_ms'     => $dbMs,
    'server_ms' => round((microtime(true) - $t0) * 1000),
]);
