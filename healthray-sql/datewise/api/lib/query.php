<?php
/*
 * Filter parsing, WHERE-clause building, paginated fetch and batch
 * hydration for the content export tool - only the fields it actually
 * displays/exports: ID, title, slug, real permalink, status, meta title,
 * meta description, publish date. Shared by list_posts.php and export.php.
 */

/** Distinct real content post types present in wp_posts (system types excluded). */
function dw_known_post_types(mysqli $conn)
{
    static $types = null;
    if ($types !== null) {
        return $types;
    }
    $excluded = dw_excluded_post_types();
    $placeholders = implode(',', array_fill(0, count($excluded), '?'));
    $stmt = $conn->prepare("SELECT DISTINCT post_type FROM wp_posts WHERE post_type NOT IN ($placeholders) ORDER BY post_type");
    dw_stmt_bind($stmt, array_map(fn($t) => ['type' => 's', 'value' => $t], $excluded));
    $stmt->execute();
    $types = array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), 'post_type');
    return $types;
}

/** Bind an array of ['type' => 's'|'i', 'value' => mixed] params onto a prepared statement. */
function dw_stmt_bind(mysqli_stmt $stmt, array $params)
{
    if (!$params) {
        return;
    }
    $types = '';
    $refs  = [];
    foreach ($params as $p) {
        $types .= $p['type'];
    }
    $refs[] = $types;
    foreach ($params as $i => $p) {
        // bind_param requires references, so bind directly into the params array.
        $refs[] = &$params[$i]['value'];
    }
    call_user_func_array([$stmt, 'bind_param'], $refs);
}

function dw_valid_date($d)
{
    if (!$d) {
        return false;
    }
    $dt = DateTime::createFromFormat('Y-m-d', $d);
    return $dt && $dt->format('Y-m-d') === $d;
}

/** Turn raw request input into a sanitized filter/search/sort array. */
function dw_parse_input(array $input, array $knownPostTypes)
{
    $postTypes = [];
    if (!empty($input['post_type'])) {
        $requested = is_array($input['post_type']) ? $input['post_type'] : explode(',', $input['post_type']);
        foreach ($requested as $t) {
            $t = trim((string) $t);
            if ($t !== '' && in_array($t, $knownPostTypes, true)) {
                $postTypes[] = $t;
            }
        }
    }
    if (!$postTypes) {
        $postTypes = array_values(array_intersect(dw_default_post_types(), $knownPostTypes));
        if (!$postTypes) {
            $postTypes = $knownPostTypes;
        }
    }

    $status = trim((string) ($input['status'] ?? 'publish'));
    $validStatuses = ['publish', 'draft', 'pending', 'private', 'future', 'trash', 'any'];
    if (!in_array($status, $validStatuses, true)) {
        $status = 'publish';
    }

    $sortKey = trim((string) ($input['sort'] ?? 'post_date'));
    if (!array_key_exists($sortKey, dw_sort_columns())) {
        $sortKey = 'post_date';
    }
    $sortDir = strtoupper(trim((string) ($input['dir'] ?? 'DESC'))) === 'ASC' ? 'ASC' : 'DESC';

    return [
        'post_types' => $postTypes,
        'status'     => $status,
        'author'     => isset($input['author']) && $input['author'] !== '' ? (int) $input['author'] : null,
        'category'   => isset($input['category']) && $input['category'] !== '' ? (int) $input['category'] : null,
        'tag'        => isset($input['tag']) && $input['tag'] !== '' ? (int) $input['tag'] : null,
        'date_from'  => dw_valid_date($input['date_from'] ?? null) ? $input['date_from'] : null,
        'date_to'    => dw_valid_date($input['date_to'] ?? null) ? $input['date_to'] : null,
        'mod_from'   => dw_valid_date($input['mod_from'] ?? null) ? $input['mod_from'] : null,
        'mod_to'     => dw_valid_date($input['mod_to'] ?? null) ? $input['mod_to'] : null,
        'search'     => trim((string) ($input['search'] ?? '')),
        'sort'       => $sortKey,
        'dir'        => $sortDir,
    ];
}

/** Build the WHERE clause + bind params shared by the count and page queries. */
function dw_build_where(array $f)
{
    $conditions = [];
    $params     = [];

    $placeholders = implode(',', array_fill(0, count($f['post_types']), '?'));
    $conditions[]  = "p.post_type IN ($placeholders)";
    foreach ($f['post_types'] as $t) {
        $params[] = ['type' => 's', 'value' => $t];
    }

    if ($f['status'] !== 'any') {
        $conditions[] = 'p.post_status = ?';
        $params[]     = ['type' => 's', 'value' => $f['status']];
    }

    if ($f['author'] !== null) {
        $conditions[] = 'p.post_author = ?';
        $params[]     = ['type' => 'i', 'value' => $f['author']];
    }

    if ($f['category'] !== null) {
        $conditions[] = "EXISTS (SELECT 1 FROM wp_term_relationships tr
            INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
            WHERE tr.object_id = p.ID AND tt.taxonomy = 'category' AND tt.term_id = ?)";
        $params[] = ['type' => 'i', 'value' => $f['category']];
    }

    if ($f['tag'] !== null) {
        $conditions[] = "EXISTS (SELECT 1 FROM wp_term_relationships tr
            INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
            WHERE tr.object_id = p.ID AND tt.taxonomy = 'post_tag' AND tt.term_id = ?)";
        $params[] = ['type' => 'i', 'value' => $f['tag']];
    }

    if ($f['date_from']) {
        $conditions[] = 'p.post_date >= ?';
        $params[]     = ['type' => 's', 'value' => $f['date_from'] . ' 00:00:00'];
    }
    if ($f['date_to']) {
        $conditions[] = 'p.post_date <= ?';
        $params[]     = ['type' => 's', 'value' => $f['date_to'] . ' 23:59:59'];
    }
    if ($f['mod_from']) {
        $conditions[] = 'p.post_modified >= ?';
        $params[]     = ['type' => 's', 'value' => $f['mod_from'] . ' 00:00:00'];
    }
    if ($f['mod_to']) {
        $conditions[] = 'p.post_modified <= ?';
        $params[]     = ['type' => 's', 'value' => $f['mod_to'] . ' 23:59:59'];
    }

    if ($f['search'] !== '') {
        $like = '%' . $f['search'] . '%';
        $conditions[] = "(p.post_title LIKE ? OR p.post_name LIKE ? OR p.post_content LIKE ?
            OR EXISTS (SELECT 1 FROM wp_postmeta spm WHERE spm.post_id = p.ID
                AND spm.meta_key IN ('_yoast_wpseo_title','_yoast_wpseo_metadesc','_yoast_wpseo_focuskw')
                AND spm.meta_value LIKE ?))";
        for ($i = 0; $i < 4; $i++) {
            $params[] = ['type' => 's', 'value' => $like];
        }
    }

    return [implode(' AND ', $conditions), $params];
}

function dw_count_posts(mysqli $conn, array $f)
{
    [$where, $params] = dw_build_where($f);
    $stmt = $conn->prepare("SELECT COUNT(*) AS total FROM wp_posts p WHERE $where");
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return (int) ($row['total'] ?? 0);
}

/** Fetch one page of basic (un-hydrated) post rows - only the columns this tool actually displays. */
function dw_fetch_posts_page(mysqli $conn, array $f, $limit, $offset)
{
    [$where, $params] = dw_build_where($f);
    $orderExpr = dw_sort_columns()[$f['sort']];

    $sql = "SELECT p.ID AS id, p.post_type, p.post_title AS title, p.post_name AS slug,
            p.post_status AS status, p.post_date, p.post_parent,
            u.display_name AS author_name
        FROM wp_posts p
        LEFT JOIN wp_users u ON u.ID = p.post_author
        WHERE $where
        ORDER BY $orderExpr $f[dir], p.ID $f[dir]
        LIMIT ? OFFSET ?";

    $stmt = $conn->prepare($sql);
    $params[] = ['type' => 'i', 'value' => (int) $limit];
    $params[] = ['type' => 'i', 'value' => (int) $offset];
    dw_stmt_bind($stmt, $params);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

/** Site home URL (wp_options "home"), cached per request. */
function dw_home_url(mysqli $conn)
{
    static $home = null;
    if ($home !== null) {
        return $home;
    }
    $res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'home' LIMIT 1");
    $row = $res ? $res->fetch_assoc() : null;
    $home = $row ? rtrim($row['option_value'], '/') : '';
    return $home;
}

/**
 * Site's actual WordPress permalink structure (wp_options "permalink_structure",
 * e.g. "%category%/%postname%/" or the flat "%postname%/") - different sites
 * really do differ here (category-based vs. flat), so "post" permalinks can't
 * be reconstructed from one hardcoded shape. Cached per request.
 */
function dw_permalink_structure(mysqli $conn)
{
    static $structure = null;
    if ($structure !== null) {
        return $structure;
    }
    $res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'permalink_structure' LIMIT 1");
    $row = $res ? $res->fetch_assoc() : null;
    $value = $row ? trim((string) $row['option_value']) : '';
    // WordPress's own fallback when "plain" (query-string) permalinks are configured.
    $structure = $value !== '' ? trim($value, '/') : '%postname%';
    return $structure;
}

/**
 * Build a "post" post-type row's relative permalink path (no domain, no
 * leading/trailing slash) by substituting the site's real permalink_structure
 * tags. Covers the tags this tool can resolve from data it already has;
 * any other tag (e.g. %author%) is dropped rather than leaking a literal
 * "%tag%" into the reconstructed URL.
 */
function dw_build_post_path($structure, array $row, $categoryPath)
{
    $timestamp = !empty($row['post_date']) ? strtotime($row['post_date']) : false;
    $replacements = [
        '%postname%' => $row['slug'] ?? '',
        '%post_id%'  => $row['id'] ?? '',
        '%category%' => $categoryPath !== '' ? $categoryPath : 'uncategorized',
        '%year%'     => $timestamp ? date('Y', $timestamp) : '',
        '%monthnum%' => $timestamp ? date('m', $timestamp) : '',
        '%day%'      => $timestamp ? date('d', $timestamp) : '',
        '%hour%'     => $timestamp ? date('H', $timestamp) : '',
        '%minute%'   => $timestamp ? date('i', $timestamp) : '',
        '%second%'   => $timestamp ? date('s', $timestamp) : '',
    ];
    $path = strtr($structure, $replacements);
    $path = preg_replace('/%[a-z_]+%/', '', $path); // drop any unresolved tag
    $path = preg_replace('#/+#', '/', $path);
    return trim($path, '/');
}

/** Site's configured UTC offset in hours (wp_options "gmt_offset"), cached per request. */
function dw_gmt_offset_hours(mysqli $conn)
{
    static $offset = null;
    if ($offset !== null) {
        return $offset;
    }
    $res = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'gmt_offset' LIMIT 1");
    $row = $res ? $res->fetch_assoc() : null;
    $offset = $row ? (float) $row['option_value'] : 0.0;
    return $offset;
}

/** Insert or update a single-value postmeta row for one post. */
function dw_upsert_postmeta(mysqli $conn, $postId, $metaKey, $value)
{
    $stmt = $conn->prepare('SELECT meta_id FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1');
    $stmt->bind_param('is', $postId, $metaKey);
    $stmt->execute();
    $exists = $stmt->get_result()->fetch_assoc();

    if ($exists) {
        $stmt = $conn->prepare('UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?');
        $stmt->bind_param('si', $value, $exists['meta_id']);
    } else {
        $stmt = $conn->prepare('INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)');
        $stmt->bind_param('iss', $postId, $metaKey, $value);
    }
    return $stmt->execute();
}

/** Light slug sanitizer - lowercase, only [a-z0-9-], collapsed/trimmed dashes. */
function dw_sanitize_slug($value)
{
    $value = strtolower(trim((string) $value));
    $value = preg_replace('/[^a-z0-9\-]+/', '-', $value);
    $value = preg_replace('/-+/', '-', $value);
    return trim($value, '-');
}

/**
 * Walk wp_term_taxonomy.parent chains for a set of category term_ids and
 * return term_id => full ancestor-to-leaf slug path (e.g. "blog/lims").
 * One query per depth level for the whole batch, not per term.
 */
function dw_category_paths(mysqli $conn, array $termIds)
{
    $paths = [];
    $frontier = []; // current term_id to resolve => [leaf term_ids that pass through it]
    foreach ($termIds as $id) {
        $paths[$id] = [];
        $frontier[$id][] = $id;
    }
    $depth = 0;
    while ($frontier && $depth < 10) {
        $ids = array_keys($frontier);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $conn->prepare("SELECT t.term_id, t.slug, tt.parent
            FROM wp_terms t INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id AND tt.taxonomy = 'category'
            WHERE t.term_id IN ($ph)");
        dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $ids));
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $byId = [];
        foreach ($rows as $r) {
            $byId[$r['term_id']] = $r;
        }

        $nextFrontier = [];
        foreach ($frontier as $currentId => $leafIds) {
            $row = $byId[$currentId] ?? null;
            if (!$row) {
                continue;
            }
            foreach ($leafIds as $leafId) {
                array_unshift($paths[$leafId], $row['slug']);
                if ((int) $row['parent'] !== 0) {
                    $nextFrontier[$row['parent']][] = $leafId;
                }
            }
        }
        $frontier = $nextFrontier;
        $depth++;
    }
    return array_map(fn($segments) => implode('/', $segments), $paths);
}

/**
 * Walk ancestor slugs given each post's immediate post_parent (already
 * known from the main query - $postIdToParentId is [post_id => post_parent],
 * 0 meaning no parent). Returns post_id => ancestor path NOT including the
 * post's own slug (e.g. "grandparent/parent"). One query per depth level
 * for the whole batch, not per post.
 */
function dw_parent_paths(mysqli $conn, array $postIdToParentId)
{
    $paths = [];
    $frontier = []; // parent id to resolve => [original post_ids whose path passes through it]
    foreach ($postIdToParentId as $postId => $parentId) {
        $paths[$postId] = [];
        if ((int) $parentId !== 0) {
            $frontier[$parentId][] = $postId;
        }
    }
    $depth = 0;
    while ($frontier && $depth < 10) {
        $ids = array_keys($frontier);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $conn->prepare("SELECT ID, post_name, post_parent FROM wp_posts WHERE ID IN ($ph)");
        dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $ids));
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $byId = [];
        foreach ($rows as $r) {
            $byId[$r['ID']] = $r;
        }

        $nextFrontier = [];
        foreach ($frontier as $currentId => $origIds) {
            $row = $byId[$currentId] ?? null;
            if (!$row) {
                continue;
            }
            foreach ($origIds as $origId) {
                array_unshift($paths[$origId], $row['post_name']);
                if ((int) $row['post_parent'] !== 0) {
                    $nextFrontier[$row['post_parent']][] = $origId;
                }
            }
        }
        $frontier = $nextFrontier;
        $depth++;
    }
    return array_map(fn($segments) => implode('/', $segments), $paths);
}

/**
 * Hydrate a batch of basic rows with exactly what's displayed/exported:
 * meta title + meta description (from a targeted postmeta lookup, not a
 * full dump) and a real permalink reconstructed from the site's actual
 * permalink structure - category/postname for posts, parent/slug for
 * pages and everything else. One or two extra queries per concern per
 * batch, never per row.
 */
function dw_hydrate_batch(mysqli $conn, array $rows)
{
    if (!$rows) {
        return [];
    }
    $ids = array_column($rows, 'id');
    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    // ── only the postmeta keys this tool needs, not a full dump ──
    $metaByPost = array_fill_keys($ids, []);
    $neededKeys = dw_needed_meta_keys();
    $keyPh = implode(',', array_fill(0, count($neededKeys), '?'));
    $stmt = $conn->prepare("SELECT post_id, meta_key, meta_value FROM wp_postmeta
        WHERE post_id IN ($placeholders) AND meta_key IN ($keyPh)");
    $bindParams = array_map(fn($id) => ['type' => 'i', 'value' => $id], $ids);
    foreach ($neededKeys as $k) {
        $bindParams[] = ['type' => 's', 'value' => $k];
    }
    dw_stmt_bind($stmt, $bindParams);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $metaByPost[$row['post_id']][$row['meta_key']] = $row['meta_value'];
    }

    // ── resolve a leaf category term_id per "post"-type row for the permalink ──
    $postTypeIds = [];
    foreach ($rows as $row) {
        if ($row['post_type'] === 'post') {
            $postTypeIds[] = $row['id'];
        }
    }
    $categoryTermIdByPost = [];
    $needFallbackCategory = [];
    foreach ($postTypeIds as $id) {
        $primary = $metaByPost[$id]['_yoast_wpseo_primary_category'] ?? '';
        if ($primary !== '' && ctype_digit((string) $primary)) {
            $categoryTermIdByPost[$id] = (int) $primary;
        } else {
            $needFallbackCategory[] = $id;
        }
    }
    if ($needFallbackCategory) {
        $ph = implode(',', array_fill(0, count($needFallbackCategory), '?'));
        $stmt = $conn->prepare("SELECT tr.object_id, MIN(t.term_id) AS term_id
            FROM wp_term_relationships tr
            INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
            INNER JOIN wp_terms t ON t.term_id = tt.term_id
            WHERE tr.object_id IN ($ph)
            GROUP BY tr.object_id");
        dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $needFallbackCategory));
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $categoryTermIdByPost[$row['object_id']] = (int) $row['term_id'];
        }
    }
    $categoryPaths = dw_category_paths($conn, array_values(array_unique($categoryTermIdByPost)));

    // ── every assigned category name per post, for display (not just the permalink's leaf category) ──
    $categoryNamesByPost = array_fill_keys($ids, []);
    $stmt = $conn->prepare("SELECT tr.object_id, t.name
        FROM wp_term_relationships tr
        INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
        INNER JOIN wp_terms t ON t.term_id = tt.term_id
        WHERE tr.object_id IN ($placeholders)
        ORDER BY t.name ASC");
    dw_stmt_bind($stmt, array_map(fn($id) => ['type' => 'i', 'value' => $id], $ids));
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $categoryNamesByPost[$row['object_id']][] = $row['name'];
    }

    // ── ancestor slug paths for hierarchical (non-"post") rows ──
    $parentMap = [];
    foreach ($rows as $row) {
        if ($row['post_type'] !== 'post') {
            $parentMap[$row['id']] = (int) $row['post_parent'];
        }
    }
    $parentPaths = dw_parent_paths($conn, $parentMap);

    $home = dw_home_url($conn);
    $postPermalinkStructure = dw_permalink_structure($conn);

    $out = [];
    foreach ($rows as $row) {
        $id      = $row['id'];
        $metaTitle = $metaByPost[$id]['_yoast_wpseo_title'] ?? '';
        if ($metaTitle === '') {
            $metaTitle = $row['title'];
        }
        $metaDescription = $metaByPost[$id]['_yoast_wpseo_metadesc'] ?? '';

        if ($row['post_type'] === 'post') {
            $catTermId = $categoryTermIdByPost[$id] ?? null;
            $catPath   = $catTermId !== null ? ($categoryPaths[$catTermId] ?? '') : '';
            $path      = dw_build_post_path($postPermalinkStructure, $row, $catPath);
        } else {
            $prefix = $parentPaths[$id] ?? '';
            $path   = ($prefix !== '' ? $prefix . '/' : '') . $row['slug'];
        }
        $permalink = $home . '/' . $path . '/';

        $out[] = [
            'id'                => (int) $id,
            'post_type'         => $row['post_type'],
            'title'             => $row['title'],
            'slug'              => $row['slug'],
            'permalink'         => $permalink,
            'status'            => $row['status'],
            'category'          => implode(', ', $categoryNamesByPost[$id] ?? []),
            'meta_title'        => $metaTitle,
            'meta_description'  => $metaDescription,
            'publish_date'      => $row['post_date'],
        ];
    }
    return $out;
}
