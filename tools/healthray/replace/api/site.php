<?php
/** GET api/site.php?db= - the sites to choose from, plus the chosen site's home URL and post types. */
require __DIR__ . '/lib.php';

$sites = [];
foreach ($DATABASES as $key => $cfg) {
    $sites[] = ['key' => $key, 'label' => $cfg['label'] ?? $key];
}

[$where, $params] = fr_post_where(['statuses' => FR_STATUSES, 'types' => [], 'ids' => []]);
$types = fr_run($conn, "SELECT p.post_type AS type, COUNT(*) AS n FROM wp_posts p WHERE $where GROUP BY p.post_type ORDER BY n DESC", $params);

json_out(true, 'ok', [
    'sites'    => $sites,
    'current'  => $ACTIVE_DB,
    'label'    => $DATABASES[$ACTIVE_DB]['label'] ?? $ACTIVE_DB,
    'home'     => fr_home_url($conn),
    'types'    => array_map(fn($t) => ['type' => $t['type'], 'n' => (int) $t['n']], $types),
    'scopes'   => FR_SCOPES,
    'statuses' => FR_STATUSES,
]);
