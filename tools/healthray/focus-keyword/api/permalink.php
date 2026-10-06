<?php

/**
 * WordPress permalink resolver — pure SQL, no WP bootstrap.
 *
 * The wp_posts.guid column is NOT the public URL (WordPress stores the ugly
 * "?p=123" form there), so the real "Original URL" has to be reconstructed
 * from the site options + permalink structure, exactly the way get_permalink()
 * does it.
 *
 * Strategy, in priority order:
 *   1. wp_yoast_indexable.permalink — Yoast caches the resolved permalink and
 *      it is authoritative when it is a pretty URL (no query string).
 *   2. Rebuild it locally from `home`, `permalink_structure`, the post name,
 *      the hierarchical category path, page ancestry and CPT rewrite slugs.
 *      This also yields the *intended* URL for drafts / pending / trashed
 *      posts, which is what the audit workflow actually needs.
 *
 * Usage:
 *     require __DIR__ . '/permalink.php';
 *     $ctx = fk_site_context($conn);
 *     $url = fk_build_permalink($row, $ctx);   // $row = wp_posts columns
 */

/** Query vars that belong to core rewrite rules, never a custom post type. */
const FK_CORE_QUERY_VARS = [
    'name',
    'pagename',
    'category_name',
    'tag',
    'author_name',
    'attachment',
    'year',
    'monthnum',
    'day',
    'paged',
    'feed',
    's',
    'p',
    'page_id',
    'post_type',
    'error',
    'cpage',
    'embed',
    'tb',
    'search',
    'robots',
    'favicon',
    'sitemap',
];

/**
 * Collect everything needed to build permalinks for one database.
 * Cached per-connection so repeated calls in a single request are free.
 */
function fk_site_context(mysqli $conn): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }

    $ctx = [
        'home'          => '',
        'structure'     => '',
        'front'         => 0,
        'default_cat'   => 0,
        'terms'         => [],   // term_id => ['slug' => .., 'parent' => ..]
        'cpt_slugs'     => [],   // post_type => rewrite slug
        'page_paths'    => [],   // page ID => full hierarchical path
        'authors'       => [],   // user ID => user_nicename
        'needs_author'  => false,
    ];

    /* ── site options ─────────────────────────────────────────────── */
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
    $ctx['home']        = rtrim(trim((string) $home), '/');
    $ctx['structure']   = trim((string) ($opts['permalink_structure'] ?? ''));
    $ctx['front']       = (int) ($opts['page_on_front'] ?? 0);
    $ctx['default_cat'] = (int) ($opts['default_category'] ?? 0);
    $ctx['needs_author'] = strpos($ctx['structure'], '%author%') !== false;

    /* ── category tree (for %category% and its hierarchy) ─────────── */
    if (strpos($ctx['structure'], '%category%') !== false) {
        $res = $conn->query(
            "SELECT t.term_id, t.slug, tt.parent
             FROM wp_terms t
             INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
             WHERE tt.taxonomy = 'category'"
        );
        if ($res) {
            while ($r = $res->fetch_assoc()) {
                $ctx['terms'][(int) $r['term_id']] = [
                    'slug'   => $r['slug'],
                    'parent' => (int) $r['parent'],
                ];
            }
            $res->free();
        }
    }

    /* ── custom post type rewrite slugs, mined from rewrite_rules ─── */
    $ctx['cpt_slugs'] = fk_extract_cpt_slugs($opts['rewrite_rules'] ?? '');

    /* ── author nicenames, only when the structure needs them ─────── */
    if ($ctx['needs_author']) {
        $res = $conn->query("SELECT ID, user_nicename FROM wp_users");
        if ($res) {
            while ($r = $res->fetch_assoc()) {
                $ctx['authors'][(int) $r['ID']] = $r['user_nicename'];
            }
            $res->free();
        }
    }

    /* ── nested page paths (pages use ancestry, not the structure) ── */
    $res = $conn->query(
        "SELECT ID, post_name, post_parent FROM wp_posts
         WHERE post_type = 'page' AND post_parent <> 0"
    );
    $nested = [];
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $nested[(int) $r['ID']] = [
                'name'   => $r['post_name'],
                'parent' => (int) $r['post_parent'],
            ];
        }
        $res->free();
    }
    if ($nested) {
        // Parents may themselves be top level, so pull every referenced ancestor.
        $missing = [];
        foreach ($nested as $n) {
            if ($n['parent'] && !isset($nested[$n['parent']])) {
                $missing[$n['parent']] = true;
            }
        }
        while ($missing) {
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

    $cache = $ctx;
    return $ctx;
}

/**
 * Pull "post_type => rewrite slug" out of the serialised rewrite_rules option.
 * Single-item rules look like:  faqs/([^/]+)/embed/?$  =>  index.php?faq=$matches[1]&embed=true
 * so the pattern prefix is the public slug ("faqs") for the CPT ("faq").
 */
function fk_extract_cpt_slugs(string $serialised): array
{
    if ($serialised === '') {
        return [];
    }
    $rules = @unserialize($serialised);
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
        // Reject anything that is itself a regex fragment.
        if ($slug === '' || preg_match('~[()\[\]\\\\?*+^$|]~', $slug)) {
            continue;
        }
        $slugs[$qv] = trim($slug, '/');
    }

    /* Archive-only rules (X/?$ => index.php?post_type=X) as a fallback. */
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
        $cursor   = $id;
        $guard    = 0;
        while ($cursor && isset($nested[$cursor]) && $guard++ < 20) {
            $segments[] = $nested[$cursor]['name'];
            $cursor     = $nested[$cursor]['parent'];
        }
        if ($cursor && $guard < 20) {
            // Top-most ancestor was resolved outside $nested — ignore, it is top level.
            $segments[] = '';
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
    $cursor   = $termId;
    $guard    = 0;
    while ($cursor && isset($terms[$cursor]) && $guard++ < 20) {
        $segments[] = $terms[$cursor]['slug'];
        $cursor     = $terms[$cursor]['parent'];
    }
    return implode('/', array_reverse($segments));
}

/**
 * WordPress appends "__trashed" to post_name when a post is trashed.
 * Strip it so the column shows the URL the post actually lived at.
 */
function fk_clean_slug(?string $slug): string
{
    $slug = (string) $slug;
    return preg_replace('~__trashed(-\d+)?$~', '', $slug);
}

/**
 * Build the public URL for one wp_posts row.
 *
 * Recognised $row keys: ID, post_type, post_status, post_name, post_date,
 * post_parent, post_author, category_ids, primary_category, yoast_permalink.
 *
 * @return array{url:string, url_source:string, url_pretty:bool}
 */
function fk_build_permalink(array $row, array $ctx): array
{
    $id     = (int) ($row['ID'] ?? 0);
    $type   = (string) ($row['post_type'] ?? 'post');
    $slug   = fk_clean_slug($row['post_name'] ?? '');
    $home   = $ctx['home'];
    $struct = $ctx['structure'];

    /* 1 ── Yoast's cached permalink wins whenever it is a real pretty URL. */
    $yoast = trim((string) ($row['yoast_permalink'] ?? ''));
    if ($yoast !== '' && strpos($yoast, '?') === false && strpos($yoast, '://') !== false) {
        return ['url' => $yoast, 'url_source' => 'yoast', 'url_pretty' => true];
    }

    if ($home === '') {
        return ['url' => '', 'url_source' => 'none', 'url_pretty' => false];
    }

    /* 2 ── Plain permalinks: nothing pretty exists on this site at all. */
    if ($struct === '') {
        $q = $type === 'page' ? "?page_id={$id}" : ($type === 'post' ? "?p={$id}" : "?post_type={$type}&p={$id}");
        return ['url' => "{$home}/{$q}", 'url_source' => 'plain', 'url_pretty' => false];
    }

    /* 3 ── Front page. */
    if ($ctx['front'] && $id === $ctx['front']) {
        return ['url' => "{$home}/", 'url_source' => 'front', 'url_pretty' => true];
    }

    if ($slug === '') {
        $q = $type === 'page' ? "?page_id={$id}" : "?p={$id}";
        return ['url' => "{$home}/{$q}", 'url_source' => 'no-slug', 'url_pretty' => false];
    }

    /* 4 ── Pages follow their ancestry, not the permalink structure. */
    if ($type === 'page') {
        $path = $ctx['page_paths'][$id] ?? $slug;
        return ['url' => "{$home}/{$path}/", 'url_source' => 'built', 'url_pretty' => true];
    }

    /* 5 ── Custom post types use their registered rewrite slug. */
    if ($type !== 'post') {
        $base = $ctx['cpt_slugs'][$type] ?? '';
        if ($base === '') {
            return [
                'url'        => "{$home}/?post_type={$type}&p={$id}",
                'url_source' => 'cpt-unknown',
                'url_pretty' => false,
            ];
        }
        return ['url' => "{$home}/{$base}/{$slug}/", 'url_source' => 'built', 'url_pretty' => true];
    }

    /* 6 ── Regular posts: expand the permalink structure tokens. */
    $date = (string) ($row['post_date'] ?? '');
    $ts   = $date !== '' && $date !== '0000-00-00 00:00:00' ? strtotime($date) : false;

    $category = '';
    if (strpos($struct, '%category%') !== false) {
        $termId = (int) ($row['primary_category'] ?? 0);
        if (!$termId || !isset($ctx['terms'][$termId])) {
            // WordPress picks the lowest term_id when there is no primary category.
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
    // Collapse any gaps left by empty tokens.
    $path = preg_replace('~/+~', '/', $path);
    $path = trim($path, '/');

    return [
        'url'        => $path === '' ? "{$home}/" : "{$home}/{$path}/",
        'url_source' => 'built',
        'url_pretty' => true,
    ];
}

/** Attach url / url_source to every row in a result set, in place. */
function fk_attach_permalinks(array &$rows, array $ctx): void
{
    foreach ($rows as &$row) {
        $built = fk_build_permalink($row, $ctx);
        $row['url']        = $built['url'];
        $row['url_source'] = $built['url_source'];
        $row['url_pretty'] = $built['url_pretty'];
    }
    unset($row);
}
