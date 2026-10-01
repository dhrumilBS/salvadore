<?php
/*
 * Filter parsing, WHERE-clause building and post fetching for the Link &
 * UTM Checker. Only post_type/status/search/date-range are pushed down to
 * SQL — everything derived from a post's extracted links (UTM/clean/no-
 * links, domain, live HTTP status) is filtered client-side over the already
 * -loaded link data, since it doesn't exist as a column to filter on.
 */

/** Distinct real content post types present in wp_posts, with counts, system types excluded. */
function lc_known_post_types(mysqli $conn, $prefix)
{
    static $cache = [];
    if (isset($cache[$prefix])) {
        return $cache[$prefix];
    }

    $excluded = lc_excluded_post_types();
    $ph = implode(',', array_fill(0, count($excluded), '?'));
    $stmt = $conn->prepare("SELECT post_type, COUNT(*) AS c FROM {$prefix}posts WHERE post_type NOT IN ($ph) GROUP BY post_type ORDER BY c DESC");
    $stmt->bind_param(str_repeat('s', count($excluded)), ...$excluded);
    $stmt->execute();
    $res = $stmt->get_result();

    $out = [];
    while ($row = $res->fetch_assoc()) {
        $out[] = ['type' => $row['post_type'], 'count' => (int) $row['c']];
    }
    return $cache[$prefix] = $out;
}

function lc_valid_date($d)
{
    if (!$d) {
        return false;
    }
    $dt = DateTime::createFromFormat('Y-m-d', $d);
    return $dt && $dt->format('Y-m-d') === $d;
}

/** Turn raw request input into a sanitized filter array. */
function lc_parse_input(array $input, array $knownPostTypes)
{
    $postType = trim((string) ($input['post_type'] ?? ''));
    if ($postType !== '' && !in_array($postType, $knownPostTypes, true)) {
        $postType = '';
    }

    $status = trim((string) ($input['status'] ?? 'publish'));
    if (!array_key_exists($status, lc_post_statuses())) {
        $status = 'publish';
    }

    return [
        'post_type' => $postType,
        'status'    => $status,
        'search'    => trim((string) ($input['q'] ?? '')),
        'date_from' => lc_valid_date($input['date_from'] ?? null) ? $input['date_from'] : null,
        'date_to'   => lc_valid_date($input['date_to'] ?? null) ? $input['date_to'] : null,
    ];
}

/** Build the WHERE clause + bind-param type string + values shared by the count and page queries. */
function lc_build_where(array $f)
{
    $conditions = [];
    $types = '';
    $params = [];

    if ($f['post_type'] !== '') {
        $conditions[] = 'post_type = ?';
        $types .= 's';
        $params[] = $f['post_type'];
    } else {
        $excluded = lc_excluded_post_types();
        $ph = implode(',', array_fill(0, count($excluded), '?'));
        $conditions[] = "post_type NOT IN ($ph)";
        $types .= str_repeat('s', count($excluded));
        array_push($params, ...$excluded);
    }

    if ($f['status'] !== 'any') {
        $conditions[] = 'post_status = ?';
        $types .= 's';
        $params[] = $f['status'];
    }

    if ($f['date_from']) {
        $conditions[] = 'post_date >= ?';
        $types .= 's';
        $params[] = $f['date_from'] . ' 00:00:00';
    }
    if ($f['date_to']) {
        $conditions[] = 'post_date <= ?';
        $types .= 's';
        $params[] = $f['date_to'] . ' 23:59:59';
    }

    if ($f['search'] !== '') {
        $conditions[] = '(post_title LIKE ? OR post_name LIKE ? OR post_content LIKE ?)';
        $like = '%' . $f['search'] . '%';
        $types .= 'sss';
        array_push($params, $like, $like, $like);
    }

    $where = $conditions ? implode(' AND ', $conditions) : '1=1';
    return [$where, $types, $params];
}

function lc_count_posts(mysqli $conn, $prefix, array $f)
{
    [$where, $types, $params] = lc_build_where($f);
    $stmt = $conn->prepare("SELECT COUNT(*) AS total FROM {$prefix}posts WHERE $where");
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return (int) ($row['total'] ?? 0);
}

/** Fetch up to $limit matching posts (with raw post_content, for link extraction), newest first. */
function lc_fetch_posts_raw(mysqli $conn, $prefix, array $f, $limit)
{
    [$where, $types, $params] = lc_build_where($f);
    $sql = "SELECT ID, post_type, post_title, post_name, post_date, post_status, post_content, guid
        FROM {$prefix}posts
        WHERE $where
        ORDER BY post_date DESC
        LIMIT ?";
    $types .= 'i';
    $params[] = (int) $limit;

    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}
