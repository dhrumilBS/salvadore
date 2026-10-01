<?php
/**
 * GET api/databases.php — the sites this tool can point at, plus which one
 * the current request resolved to (see bootstrap.php's "lc_db" cookie/param
 * resolution).
 */
require __DIR__ . '/bootstrap.php';

json_out(true, 'Databases loaded', [
    'databases' => db_list(),
    'current'   => $DB_KEY,
]);
