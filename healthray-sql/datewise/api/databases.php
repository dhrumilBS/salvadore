<?php
/**
 * GET api/databases - the sites/databases this tool can point at, plus
 * which one the current request resolved to (see bootstrap.php's "dw_db"
 * cookie/param resolution).
 */
require __DIR__ . '/bootstrap.php';

if (!isset($DATABASES) || !is_array($DATABASES)) {
    json_out(false, 'Database configuration unavailable.');
}

$list = [];
foreach ($DATABASES as $key => $cfg) {
    $list[] = ['key' => $key, 'label' => $cfg['label'] ?? $key];
}

$current = isset($DATABASES[$ACTIVE_DB]) ? $ACTIVE_DB : ($DEFAULT_DB ?? 'landing');

json_out(true, 'Databases loaded', [
    'databases' => $list,
    'current'   => $current,
]);
