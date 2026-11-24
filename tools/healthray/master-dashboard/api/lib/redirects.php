<?php
/*
 * Yoast SEO Premium redirects live in wp_options as one serialized array
 * under "wpseo-premium-redirects-base" - there's no dedicated table for
 * them. This file loads/parses that option and cross-references each
 * redirect's origin/destination path against wp_posts, so the Redirects
 * tab can flag things like "this 410 origin still matches a live post" or
 * "this 301's destination doesn't match anything published".
 */

require_once __DIR__ . '/redirect_store.php';

/**
 * All configured redirects as plain rows with slash-trimmed paths. Built on
 * redirect_store.php's dw_redirect_load() - the same reader every write uses -
 * so both of Yoast's storage layouts (indexed list, or origin => rule map) and
 * the export-map fallback are handled in one place.
 */
function dw_load_yoast_redirects(mysqli $conn)
{
    $out = [];
    $n = 0;
    foreach (dw_redirect_load($conn)['rules'] as $key => $r) {
        $out[] = [
            'id'     => is_int($key) ? $key : $n,
            'origin' => trim($r['origin'], '/'),
            'url'    => trim($r['url'], '/'),
            'type'   => (int) $r['type'],
            'format' => $r['format'],
        ];
        $n++;
    }
    return $out;
}

/** Statuses at which a post is actually reachable on the site. */
function dw_live_statuses()
{
    return ['publish', 'private', 'future'];
}

/**
 * Given a list of site-relative paths (no domain, no leading/trailing slash),
 * resolve which ones currently match a live wp_posts row - by last path
 * segment (the slug), then confirmed against that post's real reconstructed
 * permalink path (category prefix for "post" rows, ancestor slugs for
 * everything else), the same logic dw_hydrate_batch() uses for the main
 * table. Returns path => ['id','title','post_type','status'] or null.
 */
function dw_resolve_paths_to_posts(mysqli $conn, array $paths)
{
    $byLastSegment = [];
    $result = [];
    foreach (array_unique($paths) as $path) {
        $norm = trim((string) $path, '/');
        if ($norm === '' || isset($result[$norm])) {
            continue;
        }
        $result[$norm] = null;
        $segments = explode('/', $norm);
        $slug = end($segments);
        $byLastSegment[$slug][] = $norm;
    }
    if (!$byLastSegment) {
        return $result;
    }

    $knownTypes = dw_known_post_types($conn);
    $slugs = array_keys($byLastSegment);
    /*
     * A trashed post's post_name is "<slug>__trashed", so a redirect origin
     * ending in the original slug would never match it on an exact lookup -
     * which is precisely the case that matters here (retired posts are the
     * ones with 410/301 rules). WordPress adds "-2", "-3"... when a slug was
     * trashed more than once, so match "<slug>__trashed" exactly and
     * "<slug>__trashed-N" by prefix, then compare on the cleaned slug below.
     */
    $lookupSlugs = $slugs;
    foreach ($slugs as $s) {
        $lookupSlugs[] = $s . '__trashed';
    }
    $lookupSlugs = array_values(array_unique($lookupSlugs));
    $slugPh = implode(',', array_fill(0, count($lookupSlugs), '?'));
    $typePh = implode(',', array_fill(0, count($knownTypes), '?'));
    $trashedLike = implode(' OR ', array_fill(0, count($slugs), 'post_name LIKE ?'));
    $stmt = $conn->prepare("SELECT ID AS id, post_type, post_title AS title, post_status AS status,
            post_name AS slug, post_parent, post_date
        FROM wp_posts
        WHERE (post_name IN ($slugPh) OR $trashedLike) AND post_type IN ($typePh)");
    $params = array_map(fn($s) => ['type' => 's', 'value' => $s], $lookupSlugs);
    foreach ($slugs as $s) {
        $params[] = ['type' => 's', 'value' => dw_like_escape($s . '__trashed-') . '%'];
    }
    foreach ($knownTypes as $t) {
        $params[] = ['type' => 's', 'value' => $t];
    }
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $candidates = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    if (!$candidates) {
        return $result;
    }

    // ── primary-category hint (fallback to first assigned category) per "post"-type candidate ──
    $postIds = array_column(array_filter($candidates, fn($r) => $r['post_type'] === 'post'), 'id');
    $primaryByPost = [];
    if ($postIds) {
        $ph = implode(',', array_fill(0, count($postIds), '?'));
        $stmt = $conn->prepare("SELECT post_id, meta_value FROM wp_postmeta
            WHERE post_id IN ($ph) AND meta_key = '_yoast_wpseo_primary_category'");
        dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $postIds));
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $primaryByPost[$row['post_id']] = $row['meta_value'];
        }
    }

    $categoryTermIdByPost = [];
    $needFallback = [];
    foreach ($postIds as $id) {
        $primary = $primaryByPost[$id] ?? '';
        if ($primary !== '' && ctype_digit((string) $primary)) {
            $categoryTermIdByPost[$id] = (int) $primary;
        } else {
            $needFallback[] = $id;
        }
    }
    if ($needFallback) {
        $ph = implode(',', array_fill(0, count($needFallback), '?'));
        $stmt = $conn->prepare("SELECT tr.object_id, MIN(t.term_id) AS term_id
            FROM wp_term_relationships tr
            INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
            INNER JOIN wp_terms t ON t.term_id = tt.term_id
            WHERE tr.object_id IN ($ph) GROUP BY tr.object_id");
        dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $needFallback));
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $categoryTermIdByPost[$row['object_id']] = (int) $row['term_id'];
        }
    }
    $categoryPaths = dw_category_paths($conn, array_values(array_unique($categoryTermIdByPost)));

    // ── ancestor slug prefix for every non-"post" candidate ──
    $parentMap = [];
    foreach ($candidates as $row) {
        if ($row['post_type'] !== 'post') {
            $parentMap[$row['id']] = (int) $row['post_parent'];
        }
    }
    $parentPaths = dw_parent_paths($conn, $parentMap);
    $postPermalinkStructure = dw_permalink_structure($conn);

    foreach ($candidates as $row) {
        $id = $row['id'];
        if ($row['post_type'] === 'post') {
            $catTermId = $categoryTermIdByPost[$id] ?? null;
            $catPath   = $catTermId !== null ? ($categoryPaths[$catTermId] ?? '') : '';
            $fullPath  = dw_build_post_path($postPermalinkStructure, $row, $catPath);
        } else {
            $fullPath = dw_build_hierarchical_path(dw_post_type_bases($conn), $row['post_type'], $parentPaths[$id] ?? '', dw_clean_slug($row['slug']));
        }

        foreach ($byLastSegment[dw_clean_slug($row['slug'])] ?? [] as $origPath) {
            if ($result[$origPath] === null && strcasecmp($fullPath, $origPath) === 0) {
                $result[$origPath] = [
                    'id'        => (int) $id,
                    'title'     => $row['title'],
                    'post_type' => $row['post_type'],
                    'status'    => $row['status'],
                ];
            }
        }
    }

    return $result;
}

/**
 * Resolve site-relative paths to category archives. WordPress builds a category URL from the
 * permalink structure's static front ("blog/" for "/blog/%postname%/"), the category base
 * (category_base option, default "category") and the category's full parent/child slug path.
 * Returns path => ['id','title','post_type' => 'category','status'] or null. WordPress answers an
 * archive with no published posts with a 404, so an empty category gets status "empty" (not live).
 */
function dw_resolve_paths_to_categories(mysqli $conn, array $paths)
{
    $result = array_fill_keys($paths, null);
    if (!$paths) {
        return $result;
    }

    $structure = dw_permalink_structure($conn);
    $pos = strpos($structure, '%');
    $front = trim($pos === false ? '' : substr($structure, 0, $pos), '/');
    $res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'category_base' LIMIT 1");
    $row = $res ? $res->fetch_assoc() : null;
    $base = trim((string) ($row['option_value'] ?? ''), '/');
    $prefix = trim(($front !== '' ? $front . '/' : '') . ($base !== '' ? $base : 'category'), '/') . '/';

    $bySlug = [];
    foreach ($paths as $path) {
        if (stripos($path, $prefix) !== 0) {
            continue;
        }
        $catPath = trim(substr($path, strlen($prefix)), '/');
        if ($catPath === '') {
            continue;
        }
        $segments = explode('/', $catPath);
        $bySlug[end($segments)][] = ['path' => $path, 'cat' => $catPath];
    }
    if (!$bySlug) {
        return $result;
    }

    $slugs = array_keys($bySlug);
    $ph = implode(',', array_fill(0, count($slugs), '?'));
    $stmt = $conn->prepare("SELECT t.term_id, t.slug, t.name, tt.count
        FROM wp_terms t INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id AND tt.taxonomy = 'category'
        WHERE t.slug IN ($ph)");
    dw_stmt_bind($stmt, array_map(fn($s) => ['type' => 's', 'value' => $s], $slugs));
    $stmt->execute();
    $terms = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    if (!$terms) {
        return $result;
    }

    $fullPaths = dw_category_paths($conn, array_map('intval', array_column($terms, 'term_id')));
    foreach ($terms as $t) {
        $full = $fullPaths[(int) $t['term_id']] ?? '';
        foreach ($bySlug[$t['slug']] ?? [] as $want) {
            if ($result[$want['path']] === null && strcasecmp($full, $want['cat']) === 0) {
                $result[$want['path']] = [
                    'id'        => (int) $t['term_id'],
                    'title'     => $t['name'],
                    'post_type' => 'category',
                    'status'    => (int) $t['count'] > 0 ? 'publish' : 'empty',
                ];
            }
        }
    }
    return $result;
}

/** Apply the shared search/type/format/match filters used by both the list and export endpoints. */
function dw_filter_redirects(array $rows, array $f)
{
    if ($f['types']) {
        $rows = array_values(array_filter($rows, fn($r) => in_array((string) $r['type'], $f['types'], true)));
    }
    if ($f['format'] !== '') {
        $rows = array_values(array_filter($rows, fn($r) => $r['format'] === $f['format']));
    }
    if ($f['search'] !== '') {
        $needle = mb_strtolower($f['search']);
        $rows = array_values(array_filter($rows, function ($r) use ($needle) {
            return str_contains(mb_strtolower($r['origin']), $needle) || str_contains(mb_strtolower($r['url']), $needle);
        }));
    }
    return $rows;
}

/**
 * Every redirect rule with its origin/destination post matches - dw_load_yoast_redirects() +
 * dw_attach_redirect_matches() - memoised per site under ov_redirect_fingerprint(). The fingerprint
 * covers everything the matching reads (redirect options, permalink structure, every post's
 * slug/status/parent/date, the category tree, category assignments, Yoast primary categories), so a
 * memo can't go stale: any change, here or in WP admin, changes it. One batched query instead of the
 * option load + ~15 sequential round trips (Botphonic: ~3 s -> ~0.4 s); the Redirects tab's paging,
 * sorting and searching all reuse it. Filters run on the result (they only read origin/url/type/format).
 * Write paths (redirect_save.php dry runs, canonical fixes) keep resolving fresh.
 */
function dw_redirects_with_matches(mysqli $conn, $dbKey)
{
    require_once __DIR__ . '/overview.php';
    $fingerprint = ov_redirect_fingerprint($conn);
    $file = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'md-redirect-matches-'
        . preg_replace('/[^a-z0-9_-]+/i', '-', (string) $dbKey) . '.json';
    if (is_file($file)) {
        $memo = json_decode((string) @file_get_contents($file), true);
        if (is_array($memo) && ($memo['fingerprint'] ?? '') === $fingerprint && is_array($memo['rows'] ?? null)) {
            if (is_string($memo['home'] ?? null)) {
                dw_home_url($conn, $memo['home']);   // 'home' is in the fingerprint too - saves a round trip
            }
            return $memo['rows'];
        }
    }
    $rows = dw_attach_redirect_matches($conn, dw_load_yoast_redirects($conn));
    @file_put_contents($file, json_encode(['fingerprint' => $fingerprint, 'at' => date('c'), 'home' => dw_home_url($conn), 'rows' => $rows], JSON_INVALID_UTF8_SUBSTITUTE), LOCK_EX);
    return $rows;
}

/** Resolve + attach origin_post/dest_post to every row (regex-format rows have no literal path to resolve). */
function dw_attach_redirect_matches(mysqli $conn, array $rows)
{
    $paths = [];
    foreach ($rows as $r) {
        if ($r['format'] !== 'plain') {
            continue;
        }
        if ($r['origin'] !== '') {
            $paths[] = $r['origin'];
        }
        if ($r['url'] !== '') {
            $paths[] = $r['url'];
        }
    }
    $matches = dw_resolve_paths_to_posts($conn, $paths);
    // Paths no post claimed may be category archives ("/blog/category/hospital-operations/") -
    // a common, valid 301 destination that would otherwise be flagged "destination missing".
    $unresolved = array_keys(array_filter($matches, fn($m) => $m === null));
    foreach (dw_resolve_paths_to_categories($conn, $unresolved) as $path => $term) {
        if ($term !== null) {
            $matches[$path] = $term;
        }
    }

    foreach ($rows as &$r) {
        $r['origin_post'] = $r['format'] === 'plain' ? ($matches[$r['origin']] ?? null) : null;
        $r['dest_post']   = ($r['format'] === 'plain' && $r['url'] !== '') ? ($matches[$r['url']] ?? null) : null;
        // Matching a *trashed/draft* post is the normal state of a retired URL,
        // not a conflict - only a post that is still reachable counts as live.
        $r['origin_live'] = $r['origin_post'] !== null && in_array($r['origin_post']['status'], dw_live_statuses(), true);
        $r['dest_live']   = $r['dest_post'] !== null && in_array($r['dest_post']['status'], dw_live_statuses(), true);
    }
    unset($r);

    return dw_attach_redirect_chains($conn, $rows);
}

/**
 * Chains and noindex destinations, per plain 3xx rule:
 *   chain_hops  = rules a visitor passes through (1 = direct; 2+ = the destination is itself redirected)
 *   chain_final = absolute URL the chain ends at ('' when it ends in a 410 or loops)
 *   chain_gone / chain_loop = the chain ends in a 410 / comes back to a URL it already passed
 *   dest_noindex = the destination is a live post set to noindex (on the post, or by its type's default)
 * Same chain walk as the Canonicals tab (dw_canonical_follow(), max 5 hops, plain rules only).
 */
function dw_attach_redirect_chains(mysqli $conn, array $rows)
{
    require_once __DIR__ . '/canonical.php';
    $store = dw_redirect_load($conn);
    $home  = dw_home_url($conn);

    // Noindex destinations: explicit per-post noindex ("1"), or the type default unless the post forces index ("2").
    $destIds = [];
    foreach ($rows as $r) {
        if ($r['dest_live'] && ($r['dest_post']['post_type'] ?? '') !== 'category') {
            $destIds[(int) $r['dest_post']['id']] = $r['dest_post']['post_type'];
        }
    }
    $robots = [];
    if ($destIds) {
        $ph = implode(',', array_fill(0, count($destIds), '?'));
        $stmt = $conn->prepare("SELECT post_id, MAX(meta_value) AS v FROM wp_postmeta WHERE post_id IN ($ph) AND meta_key = ? GROUP BY post_id");
        $params = array_map(fn($id) => ['type' => 'i', 'value' => $id], array_keys($destIds));
        $params[] = ['type' => 's', 'value' => DW_ROBOTS_META['robots_index']];
        dw_stmt_bind($stmt, $params);
        $stmt->execute();
        foreach ($stmt->get_result()->fetch_all(MYSQLI_ASSOC) as $m) {
            $robots[(int) $m['post_id']] = trim((string) $m['v']);
        }
    }
    $typeNoindex = dw_yoast_noindex_defaults($conn);

    foreach ($rows as &$r) {
        $r['chain_hops'] = 0;
        $r['chain_final'] = '';
        $r['chain_gone'] = false;
        $r['chain_loop'] = false;
        $r['dest_noindex'] = false;
        if ($r['format'] !== 'plain' || $r['url'] === '' || dw_redirect_type_is_gone($r['type'])) {
            continue;
        }
        $f = dw_canonical_follow($store, ['origin' => $r['origin'], 'type' => $r['type'], 'url' => $r['url']], $home);
        $r['chain_hops'] = count($f['hops']);
        $r['chain_gone'] = $f['gone'];
        $r['chain_loop'] = $f['final'] === null && !$f['gone'];
        $r['chain_final'] = $f['final'] === null ? '' : ($f['external'] ? $f['final'] : dw_canonical_abs($home, $f['final']));

        // Category archives carry a term id, which can equal some post's id - never look them up as posts.
        if ($r['dest_live'] && ($r['dest_post']['post_type'] ?? '') !== 'category' && isset($destIds[(int) $r['dest_post']['id']])) {
            $v = $robots[(int) $r['dest_post']['id']] ?? '';
            $r['dest_noindex'] = $v === '1' || ($v !== '2' && !empty($typeNoindex[$r['dest_post']['post_type']]));
        }
    }
    unset($r);
    return $rows;
}

/** Keep rows matching the audit-status filter: origin still live (conflict), destination missing (broken), or healthy. */
function dw_apply_redirect_match_filter(array $rows, $matchFilter)
{
    if ($matchFilter === '') {
        return $rows;
    }

    // Regex-format rules have a pattern for an "origin", not a literal path, so
    // they're never resolved against real posts - exclude them from every status
    // bucket rather than risk a false "healthy" or false "destination missing" read.
    $rows = array_values(array_filter($rows, fn($r) => $r['format'] === 'plain'));

    if ($matchFilter === 'origin_live') {
        return array_values(array_filter($rows, fn($r) => $r['origin_live']));
    }
    // A destination that resolves only to a trashed/draft post is as broken as one that resolves to nothing.
    if ($matchFilter === 'dest_missing') {
        return array_values(array_filter($rows, fn($r) => $r['url'] !== '' && !$r['dest_live']));
    }
    // A visitor passes through 2+ rules (or the chain ends in a 410 / loops).
    if ($matchFilter === 'chain') {
        return array_values(array_filter($rows, fn($r) => ($r['chain_hops'] ?? 0) > 1));
    }
    // Sends visitors (and link equity) to a page hidden from search.
    if ($matchFilter === 'dest_noindex') {
        return array_values(array_filter($rows, fn($r) => !empty($r['dest_noindex'])));
    }
    if ($matchFilter === 'healthy') {
        return array_values(array_filter($rows, fn($r) => !$r['origin_live'] && ($r['url'] === '' || $r['dest_live'])
            && ($r['chain_hops'] ?? 0) <= 1 && empty($r['dest_noindex'])));
    }
    return $rows;
}

/** Parse+validate the query params shared by redirects.php and redirects_export.php. */
function dw_parse_redirect_input(array $input)
{
    $types = array_values(array_filter(array_map('trim', explode(',', (string) ($input['type'] ?? '')))));

    $format = trim((string) ($input['format'] ?? ''));
    if (!in_array($format, ['plain', 'regex'], true)) {
        $format = '';
    }

    $match = trim((string) ($input['match'] ?? ''));
    if (!in_array($match, ['origin_live', 'dest_missing', 'chain', 'dest_noindex', 'healthy'], true)) {
        $match = '';
    }

    $sort = trim((string) ($input['sort'] ?? 'origin'));
    if (!in_array($sort, ['origin', 'url', 'type'], true)) {
        $sort = 'origin';
    }
    $dir = strtoupper((string) ($input['dir'] ?? 'ASC')) === 'DESC' ? 'DESC' : 'ASC';

    return [
        'types'  => $types,
        'format' => $format,
        'search' => trim((string) ($input['search'] ?? '')),
        'match'  => $match,
        'sort'   => $sort,
        'dir'    => $dir,
    ];
}

/** Sort redirect rows in place by one of the whitelisted sort keys. */
function dw_sort_redirects(array $rows, $sort, $dir)
{
    usort($rows, fn($a, $b) => $a[$sort] <=> $b[$sort]);
    if ($dir === 'DESC') {
        $rows = array_reverse($rows);
    }
    return $rows;
}
