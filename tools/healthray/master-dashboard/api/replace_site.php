<?php
/**
 * GET api/replace_site.php?db= - Find & Replace tab setup for the pinned site:
 * home URL, post types (with counts), scopes and statuses. The site list comes
 * from the global switcher (databases.php), not from here.
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';

try {
    [$where, $params] = fr_post_where(['statuses' => FR_STATUSES, 'types' => [], 'ids' => []]);
    $types = fr_run($conn, "SELECT p.post_type AS type, COUNT(*) AS n FROM wp_posts p WHERE $where GROUP BY p.post_type ORDER BY n DESC", $params);
    $home = fr_home_url($conn);
} catch (Throwable $e) {
    json_out(false, 'Could not read this site: ' . $e->getMessage());
}

json_out(true, 'ok', [
    'current'  => $ACTIVE_DB,
    'label'    => $DATABASES[$ACTIVE_DB]['label'] ?? $ACTIVE_DB,
    'home'     => $home,
    'types'    => array_map(fn($t) => ['type' => $t['type'], 'n' => (int) $t['n']], $types),
    'scopes'   => FR_SCOPES,
    'statuses' => FR_STATUSES,
    'limit'    => FR_MAX_FIELDS,
]);
