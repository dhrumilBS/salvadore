<?php
/*
 * Yoast SEO Premium redirects live in wp_options as one serialized array
 * under "wpseo-premium-redirects-base" - there's no dedicated table for
 * them. This file loads/parses that option and cross-references each
 * redirect's origin/destination path against wp_posts, so the Redirects
 * tab can flag things like "this 410 origin still matches a live post" or
 * "this 301's destination doesn't match anything published".
 */

/** All configured redirects, normalized to plain arrays with slash-trimmed paths. */
function dw_load_yoast_redirects(mysqli $conn)
{
    $res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'wpseo-premium-redirects-base' LIMIT 1");
    $row = $res ? $res->fetch_assoc() : null;
    if (!$row || $row['option_value'] === '') {
        return [];
    }

    // Trusted, admin-authored plugin data - still disable object instantiation defensively.
    $data = @unserialize($row['option_value'], ['allowed_classes' => false]);
    if (!is_array($data)) {
        return [];
    }

    $out = [];
    foreach ($data as $i => $r) {
        if (!is_array($r)) {
            continue;
        }
        $out[] = [
            'id'     => (int) $i,
            'origin' => trim((string) ($r['origin'] ?? ''), '/'),
            'url'    => trim((string) ($r['url'] ?? ''), '/'),
            'type'   => (int) ($r['type'] ?? 0),
            'format' => (string) ($r['format'] ?? 'plain'),
        ];
    }
    return $out;
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
    $slugPh = implode(',', array_fill(0, count($slugs), '?'));
    $typePh = implode(',', array_fill(0, count($knownTypes), '?'));
    $stmt = $conn->prepare("SELECT ID AS id, post_type, post_title AS title, post_status AS status,
            post_name AS slug, post_parent, post_date
        FROM wp_posts
        WHERE post_name IN ($slugPh) AND post_type IN ($typePh)");
    $params = array_map(fn($s) => ['type' => 's', 'value' => $s], $slugs);
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
            $prefix   = $parentPaths[$id] ?? '';
            $fullPath = ($prefix !== '' ? $prefix . '/' : '') . $row['slug'];
        }

        foreach ($byLastSegment[$row['slug']] ?? [] as $origPath) {
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

    foreach ($rows as &$r) {
        $r['origin_post'] = $r['format'] === 'plain' ? ($matches[$r['origin']] ?? null) : null;
        $r['dest_post']   = ($r['format'] === 'plain' && $r['url'] !== '') ? ($matches[$r['url']] ?? null) : null;
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
        return array_values(array_filter($rows, fn($r) => $r['origin_post'] !== null));
    }
    if ($matchFilter === 'dest_missing') {
        return array_values(array_filter($rows, fn($r) => $r['url'] !== '' && $r['dest_post'] === null));
    }
    if ($matchFilter === 'healthy') {
        return array_values(array_filter($rows, fn($r) => $r['origin_post'] === null && ($r['url'] === '' || $r['dest_post'] !== null)));
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
    if (!in_array($match, ['origin_live', 'dest_missing', 'healthy'], true)) {
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
