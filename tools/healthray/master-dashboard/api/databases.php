<?php
/**
 * GET api/databases.php - the sites/databases this tool can point at, plus
 * which one the current request resolved to (see bootstrap.php's "md_db"
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

json_out(true, 'Databases loaded', [
    'databases' => $list,
    'current'   => $ACTIVE_DB, // always a configured key - bootstrap.php pins unknown ones to the default
]);
