<?php
/*
 * Command palette / post finder (js/finder.js) - read-only helpers for
 * finder_search.php and finder_post.php. Prefix: fd_.
 *
 * Latency is the whole design constraint: the remote sites are ~200 ms per
 * round trip, so instead of the dw_hydrate_batch() pattern (one query per
 * concern, 6-8 round trips) every endpoint folds ALL of its statements into
 * one SELECT (fd_batch) - one round trip - and rebuilds the permalink in PHP
 * with the exact same rules dw_hydrate_batch() uses (dw_build_post_path() for
 * "post", parent/slug chain for everything else, cleaned "__trashed" slugs).
 *
 * Values interpolated into SQL here are either (int) casts or go through
 * fd_q() (real_escape_string) - never raw input.
 */

/** Max ancestor levels resolved for parent/slug permalinks (joined in SQL, no extra round trip). */
const FD_ANCESTOR_DEPTH = 6;

/** Quote a string literal for inline SQL. */
function fd_q(mysqli $conn, $value)
{
    return "'" . $conn->real_escape_string((string) $value) . "'";
}

/** Quoted LIKE pattern: %value% with the value's own % and _ taken literally. */
function fd_like(mysqli $conn, $value, $prefix = '%', $suffix = '%')
{
    return fd_q($conn, $prefix . dw_like_escape($value) . $suffix);
}

/** "'a','b',..." for the excluded (internal) post types. */
function fd_excluded_types_sql(mysqli $conn)
{
    return implode(',', array_map(fn($t) => fd_q($conn, $t), dw_excluded_post_types()));
}

/**
 * Run several row-returning statements as ONE statement (one round trip).
 *
 * $parts = name => [sql, [column aliases]]. Each statement becomes a scalar
 * subquery folding its rows into JSON (JSON_ARRAYAGG of JSON_OBJECT), so the
 * whole batch is a single SELECT. (mysqli multi_query() costs two extra round
 * trips here - mysqlnd switches the multi-statement option on and off around
 * it, ~220 ms each on the remote Botphonic DB.)
 *
 * Returns name => list of assoc rows. Row order inside JSON_ARRAYAGG is not
 * guaranteed, so callers sort in PHP when order matters. Select DATETIME
 * columns as CAST(... AS CHAR) - JSON would append ".000000".
 *
 * $scalars = name => scalar subquery, returned as-is (string|null). Use it
 * for big text (post_content, serialized options): JSON escaping would
 * inflate it, and a bigger response on a fresh connection costs another
 * TCP round trip (slow start).
 */
function fd_batch(mysqli $conn, array $parts, array $scalars = [])
{
    $cols = [];
    foreach ($parts as $name => [$sql, $fields]) {
        $pairs = implode(', ', array_map(fn($f) => "'$f', d.`$f`", $fields));
        $cols[] = "(SELECT JSON_ARRAYAGG(JSON_OBJECT($pairs)) FROM ($sql) d) AS `$name`";
    }
    foreach ($scalars as $name => $sql) {
        $cols[] = "($sql) AS `$name`";
    }
    $row = $conn->query('SELECT ' . implode(",\n", $cols))->fetch_assoc();
    $out = [];
    foreach (array_keys($parts) as $name) {
        $raw = $row[$name] ?? null;
        $out[$name] = $raw === null ? [] : (json_decode($raw, true, 64, JSON_INVALID_UTF8_SUBSTITUTE) ?: []);
    }
    foreach (array_keys($scalars) as $name) {
        $out[$name] = $row[$name] ?? null;
    }
    return $out;
}

/** Sort rows in PHP by [column => 'asc'|'desc', ...] (fd_batch() does not keep SQL order). */
function fd_sort_rows(array $rows, array $by)
{
    usort($rows, function ($a, $b) use ($by) {
        foreach ($by as $col => $dir) {
            $c = ($a[$col] ?? null) <=> ($b[$col] ?? null);
            if ($c !== 0) {
                return $dir === 'desc' ? -$c : $c;
            }
        }
        return 0;
    });
    return $rows;
}

/** SQL fragment: LEFT JOINs a1..aN up the post_parent chain of alias $p. */
function fd_ancestor_joins($p = 'p')
{
    $sql = '';
    $prev = $p;
    for ($i = 1; $i <= FD_ANCESTOR_DEPTH; $i++) {
        $sql .= " LEFT JOIN wp_posts a$i ON a$i.ID = $prev.post_parent AND $prev.post_parent <> 0";
        $prev = "a$i";
    }
    return $sql;
}

/** Column aliases produced by fd_ancestor_cols(): anc1..ancN. */
function fd_ancestor_names()
{
    return array_map(fn($i) => "anc$i", range(1, FD_ANCESTOR_DEPTH));
}

/** SQL select-list fragment for the ancestor slugs (anc1 = immediate parent). */
function fd_ancestor_cols()
{
    $cols = [];
    for ($i = 1; $i <= FD_ANCESTOR_DEPTH; $i++) {
        $cols[] = "a$i.post_name AS anc$i";
    }
    return implode(', ', $cols);
}

/** SQL select-list fragment: primary category meta + MIN(category term_id) fallback (as dw_hydrate_batch). */
function fd_category_cols($p = 'p')
{
    return "(SELECT pc.meta_value FROM wp_postmeta pc WHERE pc.post_id = $p.ID AND pc.meta_key = '_yoast_wpseo_primary_category' LIMIT 1) AS primary_cat,
        (SELECT MIN(ctt.term_id) FROM wp_term_relationships ctr
            INNER JOIN wp_term_taxonomy ctt ON ctt.term_taxonomy_id = ctr.term_taxonomy_id AND ctt.taxonomy = 'category'
            WHERE ctr.object_id = $p.ID) AS min_cat";
}

/** The statement that loads every category term (small table) so paths are built in PHP. */
function fd_category_terms_sql()
{
    return "SELECT t.term_id, t.slug, tt.parent FROM wp_terms t
        INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id AND tt.taxonomy = 'category'";
}

/** term_id => "ancestor/leaf" slug path, from the rows of fd_category_terms_sql(). */
function fd_category_path_map(array $terms)
{
    $byId = [];
    foreach ($terms as $t) {
        $byId[(int) $t['term_id']] = $t;
    }
    $paths = [];
    foreach ($byId as $id => $t) {
        $segments = [];
        $cur = $id;
        $guard = 0;
        while ($cur && isset($byId[$cur]) && $guard++ < 10) {
            array_unshift($segments, $byId[$cur]['slug']);
            $cur = (int) $byId[$cur]['parent'];
        }
        $paths[$id] = implode('/', $segments);
    }
    return $paths;
}

/** option_name => option_value for the rows of a wp_options IN (...) statement. */
function fd_options_map(array $rows)
{
    $out = [];
    foreach ($rows as $r) {
        $out[$r['option_name']] = $r['option_value'];
    }
    return $out;
}

/** Same fallback as dw_permalink_structure(). */
function fd_structure($raw)
{
    $value = trim((string) $raw);
    return $value !== '' ? trim($value, '/') : '%postname%';
}

/**
 * Site-relative permalink path (no slashes around it) for a row carrying
 * id, post_type, slug, post_date, anc1..ancN, primary_cat, min_cat -
 * identical to what dw_hydrate_batch() would produce.
 */
function fd_row_path(array $row, $structure, array $catPaths)
{
    if ($row['post_type'] === 'post') {
        $primary = (string) ($row['primary_cat'] ?? '');
        $termId = ($primary !== '' && ctype_digit($primary)) ? (int) $primary : (int) ($row['min_cat'] ?? 0);
        $catPath = $termId ? ($catPaths[$termId] ?? '') : '';
        return dw_build_post_path($structure, $row, $catPath);
    }
    $segments = [];
    for ($i = FD_ANCESTOR_DEPTH; $i >= 1; $i--) {
        $slug = $row["anc$i"] ?? null;
        if ($slug !== null && $slug !== '') {
            $segments[] = dw_clean_slug($slug);
        }
    }
    $segments[] = dw_clean_slug($row['slug'] ?? '');
    return trim(implode('/', $segments), '/');
}

/** Lower-cased path with no surrounding slashes, query or fragment - the comparison key for redirect matching. */
function fd_path_key($value, $home = '')
{
    $v = trim((string) $value);
    if ($v === '') {
        return '';
    }
    if (preg_match('#^(?:[a-z][a-z0-9+.\-]*:)?//#i', $v)) {
        $host = strtolower((string) parse_url($v, PHP_URL_HOST));
        $homeHost = strtolower((string) parse_url($home, PHP_URL_HOST));
        $strip = fn($h) => preg_replace('/^www\./', '', $h);
        if ($homeHost === '' || $strip($host) !== $strip($homeHost)) {
            return ''; // another site - can never point at this post
        }
        $v = (string) parse_url($v, PHP_URL_PATH);
    }
    $v = preg_replace('~[?#].*$~', '', $v);
    return strtolower(trim(rawurldecode($v), '/'));
}

/** True when Yoast %%variables%% are present - the stored length is then not the rendered length. */
function fd_has_yoast_vars($text)
{
    return (bool) preg_match('/%%[a-z0-9_]+%%/i', (string) $text);
}
