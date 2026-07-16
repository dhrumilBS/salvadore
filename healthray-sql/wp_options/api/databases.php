<?php
/**
 * GET api/databases — the databases the panel can work against,
 * plus which one the current request resolved to.
 */
require_once __DIR__ . '/_bootstrap.php';

require_auth();

require_once __DIR__ . '/_db.php'; // $DATABASES survives even if the connect failed

if (!isset($DATABASES) || !is_array($DATABASES)) {
    json_error('Database configuration unavailable.', 500);
}

$list = [];
foreach ($DATABASES as $key => $cfg) {
    $list[] = ['key' => $key, 'label' => $cfg['label'] ?? $key];
}

json_out([
    'success'   => true,
    'databases' => $list,
    'current'   => function_exists('db_resolve_key') ? db_resolve_key() : ($list[0]['key'] ?? null),
]);
