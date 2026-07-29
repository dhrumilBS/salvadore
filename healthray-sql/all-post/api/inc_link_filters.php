<?php
/*
 * Shared whitelist + query-building helpers for specific_link.php and
 * export_link.php, so the two stay in sync and no raw GET input ever
 * reaches the SQL string.
 */

function link_post_types()
{
    return [
        'all'          => 'All',
        'page'         => 'Page',
        'post'         => 'Post',
        'whitepaper'   => 'Whitepaper',
        'events'       => 'Event',
        'case-studies' => 'Case Studies',
    ];
}

function link_statuses()
{
    return ['all', 'publish', 'draft', 'pending', 'private', 'future', 'trash'];
}

function link_sanitize_post_type($value)
{
    $types = link_post_types();
    return isset($types[$value]) ? $value : 'all';
}

function link_sanitize_status($value)
{
    return in_array($value, link_statuses(), true) ? $value : 'publish';
}

/**
 * Build the WHERE clause for the posts query from already-sanitized
 * post type / status values (only whitelisted strings ever reach here).
 */
function link_build_where($postType, $status)
{
    $conditions = [];

    if ($postType === 'all') {
        $types = array_filter(array_keys(link_post_types()), fn($t) => $t !== 'all');
        $quoted = array_map(fn($t) => "'" . $t . "'", $types);
        $conditions[] = "p.post_type IN (" . implode(',', $quoted) . ")";
    } else {
        $conditions[] = "p.post_type = '" . $postType . "'";
    }

    if ($status !== 'all') {
        $conditions[] = "p.post_status = '" . $status . "'";
    }

    return implode(' AND ', $conditions);
}

/** Re-build a query string, overriding/adding the given params on top of $_GET. */
function link_build_query(array $overrides)
{
    $params = array_merge($_GET, $overrides);
    return '?' . http_build_query($params);
}
