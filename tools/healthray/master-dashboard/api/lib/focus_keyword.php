<?php
/*
 * Focus Keyword tab (former ../../focus-keyword/ tool): duplicate Yoast focus
 * keyword audit. Read-only.
 *
 *   fk_post_type_options()  post types with totals + per-status counts
 *   fk_categories()         category terms with counts
 *   fk_fetch_keyword_rows() every post of one type/status with its focus
 *                           keyword, categories, real URL and a duplicate flag
 *
 * Permalinks: the focus-keyword tool's own resolver (permalink.php), kept
 * as-is with its fk_ prefix so it never collides with the dw_* helpers -
 * Yoast's cached indexable permalink first, otherwise rebuilt from home +
 * permalink_structure + category tree / page ancestry / CPT rewrite slugs.
 */

/** Query vars that belong to core rewrite rules, never a custom post type. */
const FK_CORE_QUERY_VARS = [
    'name', 'pagename', 'category_name', 'tag', 'author_name', 'attachment',
    'year', 'monthnum', 'day', 'paged', 'feed', 's', 'p', 'page_id',
    'post_type', 'error', 'cpage', 'embed', 'tb', 'search', 'robots',
    'favicon', 'sitemap',
];

/** URL sources that are a best-effort guess, not a real pretty permalink. */
const FK_APPROX_SOURCES = ['plain', 'no-slug', 'cpt-unknown', 'none'];

/** Separator used inside GROUP_CONCAT so category names containing ", " survive. */
const FK_CAT_SEP = "\x1F";

/**
 * Internal post types never worth auditing: the original tool's hidden list
 * plus this dashboard's dw_excluded_post_types().
 */
function fk_hidden_post_types(): array
{
    $own = [
        'revision', 'attachment', 'nav_menu_item', 'custom_css', 'customize_changeset',
        'oembed_cache', 'user_request', 'wp_block', 'wp_template', 'wp_template_part',
        'wp_global_styles', 'wp_navigation', 'acf-field', 'acf-field-group', 'acf-taxonomy',
        'acf-post-type', 'acf-ui-options-page', 'elementor_library', 'e-landing-page',
        'e_global_class', 'elementor_font', 'wpcf7_contact_form', 'wpcf7r_action',
        'cf7_to_any_api', 'frm_form_actions', 'frm_styles', 'wpcode', 'scheduled-action',
    ];
    return array_values(array_unique(array_merge($own, dw_excluded_post_types())));
}

/** Normalised duplicate key for a focus keyword ('' = no keyword). Same rule as the original. */
function fk_keyword_key($kw): string
{
    return trim(strtolower((string) $kw));
}

/* ══════════════════════════ Options ══════════════════════════ */

/**
 * Post types (post, page first, then by volume) with total + per-status
 * counts, and site-wide status totals. Returns null when the query failed.
 */
function fk_post_type_options(mysqli $conn): ?array
{
    $hidden = fk_hidden_post_types();
    $placeholders = implode(',', array_fill(0, count($hidden), '?'));
    $sql = "SELECT post_type, post_status, COUNT(*) AS n
            FROM wp_posts
            WHERE post_status NOT IN ('auto-draft','inherit')
              AND post_type NOT IN ($placeholders)
            GROUP BY post_type, post_status";

    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        error_log('fk_post_type_options prepare: ' . $conn->error);
        return null;
    }
    $stmt->bind_param(str_repeat('s', count($hidden)), ...$hidden);
    if (!$stmt->execute()) {
        error_log('fk_post_type_options execute: ' . $stmt->error);
        $stmt->close();
        return null;
    }
    $res = $stmt->get_result();

    $types = [];
    $statuses = [];
    while ($row = $res->fetch_assoc()) {
        $pt = $row['post_type'];
        $st = $row['post_status'];
        $n  = (int) $row['n'];
        if (!isset($types[$pt])) {
            $types[$pt] = ['name' => $pt, 'total' => 0, 'statuses' => []];
        }
        $types[$pt]['total'] += $n;
        $types[$pt]['statuses'][$st] = ($types[$pt]['statuses'][$st] ?? 0) + $n;
        $statuses[$st] = ($statuses[$st] ?? 0) + $n;
    }
    $stmt->close();

    uasort($types, function ($a, $b) {
        $rank = ['post' => 0, 'page' => 1];
        $ra = $rank[$a['name']] ?? 2;
        $rb = $rank[$b['name']] ?? 2;
        return $ra === $rb ? $b['total'] <=> $a['total'] : $ra <=> $rb;
    });
    arsort($statuses);

    return ['post_types' => array_values($types), 'status_counts' => $statuses];
}

/** Category terms, most used first. Returns null when the query failed. */
function fk_categories(mysqli $conn): ?array
{
    $res = $conn->query(
        "SELECT t.term_id, t.name, t.slug, tt.count
         FROM wp_terms t
         INNER JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
         WHERE tt.taxonomy = 'category'
         ORDER BY tt.count DESC, t.name ASC"
    );
    if (!$res) {
        error_log('fk_categories: ' . $conn->error);
        return null;
    }
    $out = [];
    while ($r = $res->fetch_assoc()) {
        $out[] = ['term_id' => (int) $r['term_id'], 'name' => $r['name'], 'slug' => $r['slug'], 'count' => (int) $r['count']];
    }
    $res->free();
    return $out;
}

/* ══════════════════════════ Rows ══════════════════════════ */

/**
 * Port of get-posts.php. Every post of $postType with $postStatus ('any' =
 * every status except auto-draft/inherit), with its focus keyword, categories,
 * real URL and a duplicate flag (same keyword, case-insensitive, used more
 * than once within this type/status). $onlyDuplicate keeps only those rows -
 * keywordCount is always computed over the full set, as in the original.
 *
 * @return array{rows:array, keywordCount:array, site_home:string}|null  null on a DB error
 */
function fk_fetch_keyword_rows(mysqli $conn, string $postType, string $postStatus, bool $onlyDuplicate): ?array
{
    $anyStatus = ($postStatus === '' || $postStatus === 'any');
    $statusClause = $anyStatus
        ? "AND p.post_status NOT IN ('auto-draft','inherit')"
        : "AND p.post_status = ?";

    $sep = FK_CAT_SEP;
    $sql = "SELECT
        p.ID, p.post_name, p.post_title, p.post_type, p.post_status,
        p.post_date, p.post_modified, p.post_parent, p.post_author,
        MAX(pm.meta_value)  AS focus_keyword,
        MAX(pmc.meta_value) AS primary_category,
        MAX(yi.permalink)   AS yoast_permalink,
        GROUP_CONCAT(DISTINCT tt.term_id ORDER BY tt.term_id ASC) AS category_ids,
        GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR '$sep') AS categories
    FROM wp_posts p
    LEFT JOIN wp_postmeta pm
        ON pm.post_id = p.ID AND pm.meta_key = '_yoast_wpseo_focuskw'
    LEFT JOIN wp_postmeta pmc
        ON pmc.post_id = p.ID AND pmc.meta_key = '_yoast_wpseo_primary_category'
    LEFT JOIN wp_yoast_indexable yi
        ON yi.object_id = p.ID AND yi.object_type = 'post'
    LEFT JOIN wp_term_relationships tr
        ON p.ID = tr.object_id
    LEFT JOIN wp_term_taxonomy tt
        ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = 'category'
    LEFT JOIN wp_terms t
        ON tt.term_id = t.term_id
    WHERE p.post_type = ?
        $statusClause
    GROUP BY p.ID
    ORDER BY focus_keyword DESC, p.post_modified DESC";

    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        error_log('fk_fetch_keyword_rows prepare: ' . $conn->error);
        return null;
    }
    if ($anyStatus) {
        $stmt->bind_param('s', $postType);
    } else {
        $stmt->bind_param('ss', $postType, $postStatus);
    }
    if (!$stmt->execute()) {
        error_log('fk_fetch_keyword_rows execute: ' . $stmt->error);
        $stmt->close();
        return null;
    }
    $result = $stmt->get_result();

    $raw = [];
    $keywordCount = [];
    while ($row = $result->fetch_assoc()) {
        $fk = fk_keyword_key($row['focus_keyword'] ?? '');
        if ($fk !== '') {
            $keywordCount[$fk] = ($keywordCount[$fk] ?? 0) + 1;
        }
        $raw[] = $row;
    }
    $stmt->close();

    $ctx = fk_site_context($conn);
    $rows = [];
    foreach ($raw as $r) {
        $key = fk_keyword_key($r['focus_keyword'] ?? '');
        $dup = $key !== '' && $keywordCount[$key] > 1;
        if ($onlyDuplicate && !$dup) {
            continue;
        }
        $built = fk_build_permalink($r, $ctx);
        $cats = ($r['categories'] ?? '') === '' ? [] : explode(FK_CAT_SEP, $r['categories']);
        $rows[] = [
            'id'            => (int) $r['ID'],
            'title'         => (string) $r['post_title'],
            'slug'          => (string) $r['post_name'],
            'post_type'     => (string) $r['post_type'],
            'post_status'   => (string) $r['post_status'],
            'post_date'     => (string) $r['post_date'],
            'post_modified' => (string) $r['post_modified'],
            'focus_keyword' => (string) ($r['focus_keyword'] ?? ''),
            'kw_key'        => $key,
            'duplicate'     => $dup,
            'categories'    => implode(', ', $cats),
            'category_list' => $cats,
            'url'           => $built['url'],
            'url_source'    => $built['url_source'],
            'approx'        => !$built['url_pretty'] || in_array($built['url_source'], FK_APPROX_SOURCES, true),
        ];
    }

    return ['rows' => $rows, 'keywordCount' => $keywordCount, 'site_home' => $ctx['home']];
}

/* ══════════════════════════ Permalinks (port of permalink.php) ══════════════════════════ */

/** Everything needed to build permalinks for one database. Cached per connection. */
function fk_site_context(mysqli $conn): array
{
    static $cache = [];
    $cacheKey = spl_object_id($conn);
    if (isset($cache[$cacheKey])) {
        return $cache[$cacheKey];
    }

    $ctx = [
        'home'         => '',
        'structure'    => '',
        'front'        => 0,
        'default_cat'  => 0,
        'terms'        => [],   // term_id => ['slug' => .., 'parent' => ..]
        'cpt_slugs'    => [],   // post_type => rewrite slug
        'page_paths'   => [],   // page ID => full hierarchical path
        'authors'      => [],   // user ID => user_nicename
        'needs_author' => false,
    ];

    $res = $conn->query(
        "SELECT option_name, option_value FROM wp_options
         WHERE option_name IN ('home','siteurl','permalink_structure','page_on_front','default_category','rewrite_rules')"
    );
    $opts = [];
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $opts[$r['option_name']] = $r['option_value'];
        }
        $res->free();
    }

    $home = $opts['home'] ?? ($opts['siteurl'] ?? '');
    $ctx['home']         = rtrim(trim((string) $home), '/');
    $ctx['structure']    = trim((string) ($opts['permalink_structure'] ?? ''));
    $ctx['front']        = (int) ($opts['page_on_front'] ?? 0);
    $ctx['default_cat']  = (int) ($opts['default_category'] ?? 0);
    $ctx['needs_author'] = strpos($ctx['structure'], '%author%') !== false;

    if (strpos($ctx['structure'], '%category%') !== false) {
        $res = $conn->query(
            "SELECT t.term_id, t.slug, tt.parent
             FROM wp_terms t
             INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
             WHERE tt.taxonomy = 'category'"
        );
        if ($res) {
            while ($r = $res->fetch_assoc()) {
                $ctx['terms'][(int) $r['term_id']] = ['slug' => $r['slug'], 'parent' => (int) $r['parent']];
            }
            $res->free();
        }
    }

    $ctx['cpt_slugs'] = fk_extract_cpt_slugs($opts['rewrite_rules'] ?? '');

    if ($ctx['needs_author']) {
        $res = $conn->query("SELECT ID, user_nicename FROM wp_users");
        if ($res) {
            while ($r = $res->fetch_assoc()) {
                $ctx['authors'][(int) $r['ID']] = $r['user_nicename'];
            }
            $res->free();
        }
    }

    $res = $conn->query(
        "SELECT ID, post_name, post_parent FROM wp_posts
         WHERE post_type = 'page' AND post_parent <> 0"
    );
    $nested = [];
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $nested[(int) $r['ID']] = ['name' => $r['post_name'], 'parent' => (int) $r['post_parent']];
        }
        $res->free();
    }
    if ($nested) {
        $missing = [];
        foreach ($nested as $n) {
            if ($n['parent'] && !isset($nested[$n['parent']])) {
                $missing[$n['parent']] = true;
            }
        }
        $rounds = 0;
        while ($missing && $rounds++ < 20) {
            $ids = implode(',', array_map('intval', array_keys($missing)));
            $missing = [];
            $res = $conn->query("SELECT ID, post_name, post_parent FROM wp_posts WHERE ID IN ($ids)");
            if (!$res) {
                break;
            }
            while ($r = $res->fetch_assoc()) {
                $id = (int) $r['ID'];
                $nested[$id] = ['name' => $r['post_name'], 'parent' => (int) $r['post_parent']];
                if ($nested[$id]['parent'] && !isset($nested[$nested[$id]['parent']])) {
                    $missing[$nested[$id]['parent']] = true;
                }
            }
            $res->free();
        }
        $ctx['page_paths'] = fk_resolve_page_paths($nested);
    }

    $cache[$cacheKey] = $ctx;
    return $ctx;
}

/** "post_type => rewrite slug" mined from the serialised rewrite_rules option. */
function fk_extract_cpt_slugs(string $serialised): array
{
    if ($serialised === '') {
        return [];
    }
    $rules = @unserialize($serialised, ['allowed_classes' => false]);
    if (!is_array($rules)) {
        return [];
    }

    $slugs = [];
    foreach ($rules as $pattern => $target) {
        if (!is_string($pattern) || !is_string($target)) {
            continue;
        }
        if (!preg_match('~^index\.php\?([a-z0-9_\-]+)=\$matches\[1\]~i', $target, $m)) {
            continue;
        }
        $qv = $m[1];
        if (isset($slugs[$qv]) || in_array($qv, FK_CORE_QUERY_VARS, true)) {
            continue;
        }
        $pos = strpos($pattern, '/([^/]+)');
        if ($pos === false || $pos === 0) {
            continue;
        }
        $slug = substr($pattern, 0, $pos);
        if ($slug === '' || preg_match('~[()\[\]\\\\?*+^$|]~', $slug)) {
            continue;
        }
        $slugs[$qv] = trim($slug, '/');
    }

    foreach ($rules as $pattern => $target) {
        if (!is_string($target) || !preg_match('~^index\.php\?post_type=([a-z0-9_\-]+)$~i', $target, $m)) {
            continue;
        }
        $pt = $m[1];
        if (isset($slugs[$pt])) {
            continue;
        }
        $slug = preg_replace('~/\?\$$~', '', (string) $pattern);
        if ($slug !== '' && !preg_match('~[()\[\]\\\\?*+^$|]~', $slug)) {
            $slugs[$pt] = trim($slug, '/');
        }
    }

    return $slugs;
}

/** Flatten a parent/child page map into "grand/parent/child" paths. */
function fk_resolve_page_paths(array $nested): array
{
    $paths = [];
    foreach ($nested as $id => $_) {
        $segments = [];
        $cursor = $id;
        $guard = 0;
        while ($cursor && isset($nested[$cursor]) && $guard++ < 20) {
            $segments[] = $nested[$cursor]['name'];
            $cursor = $nested[$cursor]['parent'];
        }
        $segments = array_values(array_filter(array_reverse($segments), fn($s) => $s !== ''));
        if ($segments) {
            $paths[$id] = implode('/', $segments);
        }
    }
    return $paths;
}

/** Full hierarchical slug path for a category term ("blog/hims"). */
function fk_category_path(int $termId, array $terms): string
{
    if (!isset($terms[$termId])) {
        return '';
    }
    $segments = [];
    $cursor = $termId;
    $guard = 0;
    while ($cursor && isset($terms[$cursor]) && $guard++ < 20) {
        $segments[] = $terms[$cursor]['slug'];
        $cursor = $terms[$cursor]['parent'];
    }
    return implode('/', array_reverse($segments));
}

/** Strip WordPress' "__trashed" suffix so the URL is the one the post lived at. */
function fk_clean_slug(?string $slug): string
{
    return preg_replace('~__trashed(-\d+)?$~', '', (string) $slug);
}

/**
 * Public URL for one wp_posts row (+ category_ids, primary_category, yoast_permalink).
 * @return array{url:string, url_source:string, url_pretty:bool}
 */
function fk_build_permalink(array $row, array $ctx): array
{
    $id     = (int) ($row['ID'] ?? 0);
    $type   = (string) ($row['post_type'] ?? 'post');
    $slug   = fk_clean_slug($row['post_name'] ?? '');
    $home   = $ctx['home'];
    $struct = $ctx['structure'];

    $yoast = trim((string) ($row['yoast_permalink'] ?? ''));
    if ($yoast !== '' && strpos($yoast, '?') === false && strpos($yoast, '://') !== false) {
        return ['url' => $yoast, 'url_source' => 'yoast', 'url_pretty' => true];
    }

    if ($home === '') {
        return ['url' => '', 'url_source' => 'none', 'url_pretty' => false];
    }

    if ($struct === '') {
        $q = $type === 'page' ? "?page_id={$id}" : ($type === 'post' ? "?p={$id}" : "?post_type={$type}&p={$id}");
        return ['url' => "{$home}/{$q}", 'url_source' => 'plain', 'url_pretty' => false];
    }

    if ($ctx['front'] && $id === $ctx['front']) {
        return ['url' => "{$home}/", 'url_source' => 'front', 'url_pretty' => true];
    }

    if ($slug === '') {
        $q = $type === 'page' ? "?page_id={$id}" : "?p={$id}";
        return ['url' => "{$home}/{$q}", 'url_source' => 'no-slug', 'url_pretty' => false];
    }

    if ($type === 'page') {
        $path = $ctx['page_paths'][$id] ?? $slug;
        return ['url' => "{$home}/{$path}/", 'url_source' => 'built', 'url_pretty' => true];
    }

    if ($type !== 'post') {
        $base = $ctx['cpt_slugs'][$type] ?? '';
        if ($base === '') {
            return ['url' => "{$home}/?post_type={$type}&p={$id}", 'url_source' => 'cpt-unknown', 'url_pretty' => false];
        }
        return ['url' => "{$home}/{$base}/{$slug}/", 'url_source' => 'built', 'url_pretty' => true];
    }

    $date = (string) ($row['post_date'] ?? '');
    $ts = $date !== '' && $date !== '0000-00-00 00:00:00' ? strtotime($date) : false;

    $category = '';
    if (strpos($struct, '%category%') !== false) {
        $termId = (int) ($row['primary_category'] ?? 0);
        if (!$termId || !isset($ctx['terms'][$termId])) {
            $ids = array_filter(array_map('intval', explode(',', (string) ($row['category_ids'] ?? ''))));
            $termId = $ids ? min($ids) : 0;
        }
        if (!$termId) {
            $termId = $ctx['default_cat'];
        }
        $category = fk_category_path($termId, $ctx['terms']);
        if ($category === '') {
            $category = 'uncategorized';
        }
    }

    $replacements = [
        '%year%'     => $ts ? date('Y', $ts) : '',
        '%monthnum%' => $ts ? date('m', $ts) : '',
        '%day%'      => $ts ? date('d', $ts) : '',
        '%hour%'     => $ts ? date('H', $ts) : '',
        '%minute%'   => $ts ? date('i', $ts) : '',
        '%second%'   => $ts ? date('s', $ts) : '',
        '%post_id%'  => (string) $id,
        '%postname%' => $slug,
        '%category%' => $category,
        '%author%'   => $ctx['authors'][(int) ($row['post_author'] ?? 0)] ?? '',
    ];

    $path = strtr($struct, $replacements);
    $path = preg_replace('~/+~', '/', $path);
    $path = trim($path, '/');

    return [
        'url'        => $path === '' ? "{$home}/" : "{$home}/{$path}/",
        'url_source' => 'built',
        'url_pretty' => true,
    ];
}
