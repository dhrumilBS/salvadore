<?php
/**
 * conn.php — Server-side DB configuration for the Link & UTM Checker.
 *
 * Single source of truth for site credentials. Credentials are NEVER sent to
 * the frontend — the browser only ever sends a "db" key, and everything else
 * (host/user/pass) stays server-side. Mirrors the $DATABASES/db_connect()/
 * db_resolve_key() shape used by ../botphonic-sql/conn.php so this tool's
 * pattern is familiar across the repo.
 */

$DATABASES = [
    'healthray' => [
        'label' => 'Healthray',
        'host'  => '143.110.176.144',
        'name'  => 'wp_healthray_landing',
        'user'  => 'office_landing',
        'pass'  => 'Health@L@N-DB4({^&*8*U&Jg6J6P',
        'port'  => 3306,
        'prefix' => 'wp_',
    ],

    'botphonic' => [
        'label' => 'Botphonic',
        'host'  => '52.5.152.133',
        'name'  => 'wp_botphonic_landing',
        'user'  => 'office_landing',
        'pass'  => 'BOT@phoL@NDB({^&*U&Jg6J6P',
        'port'  => 3306,
        'prefix' => 'wp_',
    ],
];

/* Default database key used when none is requested or the key is unknown. */
$DEFAULT_DB = 'healthray';

/**
 * Open a mysqli connection for the given database key. Unknown keys fall
 * back to the default database, so callers can pass untrusted input safely —
 * only databases declared above are ever reachable.
 */
function db_connect($key = null)
{
    global $DATABASES, $DEFAULT_DB;

    if (!is_string($key) || !isset($DATABASES[$key])) {
        $key = $DEFAULT_DB;
    }
    $cfg = $DATABASES[$key];

    $conn = new mysqli($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name'], $cfg['port'] ?? 3306);
    if ($conn->connect_error) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        die(json_encode(['success' => false, 'msg' => 'DB connection failed (' . $key . '): ' . $conn->connect_error]));
    }
    $conn->set_charset('utf8mb4');
    return $conn;
}

/**
 * Resolve which database a request should use, in priority order:
 *   1. $ACTIVE_DB set in PHP before requiring this file (explicit override)
 *   2. ?db= in the query string or a "db" POST field
 *   3. the "lc_db" cookie (a selection that sticks across page loads)
 *   4. the default database
 * Unknown keys are ignored by db_connect(), so this is safe with raw input.
 */
function db_resolve_key()
{
    global $ACTIVE_DB, $DATABASES, $DEFAULT_DB;

    foreach ([$ACTIVE_DB ?? null, $_GET['db'] ?? null, $_POST['db'] ?? null, $_COOKIE['lc_db'] ?? null] as $candidate) {
        if (is_string($candidate) && isset($DATABASES[$candidate])) {
            return $candidate;
        }
    }
    return $DEFAULT_DB;
}

/** Config (label/prefix/etc, never credentials) for a resolved db key. */
function db_config($key)
{
    global $DATABASES, $DEFAULT_DB;
    return $DATABASES[$key] ?? $DATABASES[$DEFAULT_DB];
}

/** Site list with only key + label (no credentials) for the UI's Site switcher. */
function db_list()
{
    global $DATABASES;
    $out = [];
    foreach ($DATABASES as $key => $cfg) {
        $out[] = ['key' => $key, 'label' => $cfg['label']];
    }
    return $out;
}
