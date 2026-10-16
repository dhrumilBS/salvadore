<?php
/**
 * GET api/finder_search.php?q=... - command palette post search (read-only).
 *
 * Up to 10 posts of any real content type (drafts / private / scheduled
 * included; trash last; auto-drafts and revisions never):
 *   - numeric q        -> that post ID first, then titles containing the number
 *   - URL or path      -> slug from dw_extract_slug_from_input(); a post whose
 *                         real permalink path equals the pasted path ranks first
 *   - anything else    -> every word must appear in the title or slug;
 *                         exact title, then title-prefix, then word-start matches first
 * One database round trip (see lib/finder.php).
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/finder.php';

$t0 = microtime(true);
$q = trim((string) (is_string($_GET['q'] ?? null) ? $_GET['q'] : ''));
$q = mb_substr(preg_replace('/\s+/u', ' ', $q), 0, 200);
if ($q === '') {
    json_out(true, 'OK', ['data' => [], 'mode' => 'empty']);
}

$limit = 10;
$excluded = fd_excluded_types_sql($conn);

$isUrl = (bool) preg_match('#^(https?://|www\.|/)#i', $q) || (strpos($q, '/') !== false && strpos($q, ' ') === false);
$isId  = ctype_digit($q) && strlen($q) <= 10;

$wantPath = '';
if ($isUrl) {
    $mode = 'url';
    $slug = dw_extract_slug_from_input($q);
    if ($slug === '') {
        // The site root: the static front page, if one is set.
        $cond = "p.ID = (SELECT CAST(option_value AS UNSIGNED) FROM wp_options WHERE option_name = 'page_on_front' LIMIT 1)";
        $rank = '0';
    } else {
        $s = fd_q($conn, $slug);
        $cond = "(p.post_name = $s OR p.post_name LIKE " . fd_like($conn, $slug . '__trashed', '', '%') .
            ' OR p.post_name LIKE ' . fd_like($conn, $slug) . ')';
        $rank = "CASE WHEN p.post_name = $s THEN 0 WHEN p.post_name LIKE " . fd_like($conn, $slug . '__trashed', '', '%') . ' THEN 1 ELSE 3 END';
    }
} else {
    $mode = $isId ? 'id' : 'text';
    $words = array_values(array_filter(explode(' ', $q), fn($w) => $w !== ''));
    $wordConds = [];
    foreach (array_slice($words, 0, 8) as $w) {
        // Apostrophes are stored as ', &#039; or a curly quote - match the pieces around them in order.
        $pieces = array_values(array_filter(preg_split("/['\x{2019}]/u", $w), fn($x) => $x !== ''));
        $wSlug = dw_sanitize_slug(implode('', $pieces));
        $c = 'p.post_title LIKE ' . fd_q($conn, '%' . implode('%', array_map('dw_like_escape', $pieces ?: [$w])) . '%');
        if ($wSlug !== '') {
            $c .= ' OR p.post_name LIKE ' . fd_like($conn, $wSlug);
        }
        $wordConds[] = "($c)";
    }
    $cond = '(' . implode(' AND ', $wordConds) . ')';
    $qSlug = dw_sanitize_slug($q);
    $rank = 'CASE WHEN p.post_title = ' . fd_q($conn, $q) . ' THEN 0'
        . ' WHEN p.post_title LIKE ' . fd_like($conn, $q, '') . ' THEN 1'
        . ($qSlug !== '' ? ' WHEN p.post_name = ' . fd_q($conn, $qSlug) . ' THEN 1' : '')
        . ' WHEN p.post_title LIKE ' . fd_like($conn, $q, '% ') . ' THEN 2'
        . ' WHEN p.post_title LIKE ' . fd_like($conn, $q) . ' THEN 3'
        . ($qSlug !== '' ? ' WHEN p.post_name LIKE ' . fd_like($conn, $qSlug, '') . ' THEN 4' : '')
        . ' ELSE 5 END';
    if ($isId) {
        $cond = '(p.ID = ' . (int) $q . " OR $cond)";
        $rank = 'CASE WHEN p.ID = ' . (int) $q . " THEN -1 ELSE $rank END";
    }
}

// Inner query picks + ranks the IDs; the outer one adds permalink inputs for those rows only
// (sorted again in PHP - fd_batch() does not keep SQL row order).
$searchSql = "SELECT p.ID AS id, p.post_type, p.post_title AS title, p.post_name AS slug,
        p.post_status AS status, CAST(p.post_date AS CHAR) AS post_date, CAST(p.post_modified AS CHAR) AS post_modified,
        p.post_parent, x.rnk, x.is_trash, x.not_pub,
        " . fd_ancestor_cols() . ",
        " . fd_category_cols('p') . "
    FROM (
        SELECT p.ID, ($rank) AS rnk, (p.post_status = 'trash') AS is_trash, (p.post_status <> 'publish') AS not_pub, p.post_modified AS m
        FROM wp_posts p
        WHERE p.post_type NOT IN ($excluded)
            AND p.post_status NOT IN ('auto-draft', 'inherit')
            AND $cond
        ORDER BY is_trash, rnk, not_pub, m DESC, p.ID DESC
        LIMIT " . ($limit * 2) . "
    ) x
    INNER JOIN wp_posts p ON p.ID = x.ID
    " . fd_ancestor_joins('p');

$optSql = "SELECT option_name, option_value FROM wp_options WHERE option_name IN ('home', 'permalink_structure', 'page_on_front')";

try {
    $res = fd_batch($conn, [
        'rows'  => [$searchSql, array_merge(['id', 'post_type', 'title', 'slug', 'status', 'post_date', 'post_modified', 'post_parent', 'rnk', 'is_trash', 'not_pub', 'primary_cat', 'min_cat'], fd_ancestor_names())],
        'terms' => [fd_category_terms_sql(), ['term_id', 'slug', 'parent']],
        'opts'  => [$optSql, ['option_name', 'option_value']],
    ]);
    $rows = fd_sort_rows($res['rows'], ['is_trash' => 'asc', 'rnk' => 'asc', 'not_pub' => 'asc', 'post_modified' => 'desc', 'id' => 'desc']);
    $terms = $res['terms'];
    $optRows = $res['opts'];
} catch (Throwable $e) {
    error_log('finder_search: ' . $e->getMessage());
    http_response_code(500);
    json_out(false, 'Search failed');
}

$opts = fd_options_map($optRows);
$home = rtrim((string) ($opts['home'] ?? ''), '/');
$structure = fd_structure($opts['permalink_structure'] ?? '');
$catPaths = fd_category_path_map($terms);
$typeBases = dw_post_type_bases($conn);
$frontId = (int) ($opts['page_on_front'] ?? 0);
if ($mode === 'url') {
    $wantPath = fd_path_key(preg_match('#^www\.#i', $q) ? 'https://' . $q : $q, $home);
}

$out = [];
foreach ($rows as $r) {
    $path = fd_row_path($r, $structure, $catPaths, $typeBases);
    $match = 'title';
    if ($mode === 'id' && (int) $r['id'] === (int) $q) {
        $match = 'id';
    } elseif ($mode === 'url') {
        $match = ($slug === '' || ($wantPath !== '' && strtolower($path) === $wantPath)) ? 'path' : ((int) $r['rnk'] <= 1 ? 'slug' : 'similar');
    }
    $out[] = [
        'id'        => (int) $r['id'],
        'title'     => (string) $r['title'],
        'title_text' => html_entity_decode((string) $r['title'], ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'post_type' => $r['post_type'],
        'status'    => $r['status'],
        'path'      => $path,
        // The static front page is served at the site root, not at its own slug.
        'permalink' => $home . '/' . ($path !== '' && (int) $r['id'] !== $frontId ? $path . '/' : ''),
        'modified'  => $r['post_modified'],
        'match'     => $match,
    ];
}

// A pasted URL: the post that actually lives at that path beats a same-slug post elsewhere.
if ($mode === 'url') {
    $order = ['path' => 0, 'slug' => 1, 'similar' => 2];
    usort($out, fn($a, $b) => ($order[$a['match']] ?? 3) <=> ($order[$b['match']] ?? 3)); // usort is stable in PHP 8
}

json_out(true, 'OK', [
    'data'      => array_slice($out, 0, $limit),
    'mode'      => $mode,
    'home'      => $home,
    'server_ms' => round((microtime(true) - $t0) * 1000),
]);
