<?php
require __DIR__ . '/vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

/*
 * ── Available databases ──────────────────────────────────────────────
 * Add an entry here to expose another database to the UI.
 * The array key is what the frontend sends as the "db" parameter;
 * "label" is shown in the selector. 'landing' is the default (live remote).
 */
$DATABASES = [
    'landing' => [
        'label' => 'Landing — Live',
        'host'  => $_ENV['DB_HOST'],
        'user'  => $_ENV['DB_USER'],
        'pass'  => $_ENV['DB_PASS'],
        'name'  => $_ENV['DB_NAME'],
        'port'  => (int) $_ENV['DB_PORT'],
    ],
    'botphonic' => [
        'label' => 'Botphonic',
        'host'  => $_ENV['DB_BP_HOST'],
        'user'  => $_ENV['DB_BP_USER'],
        'pass'  => $_ENV['DB_BP_PASS'],
        'name'  => $_ENV['DB_BP_NAME'],
        'port'  => (int) ($_ENV['DB_BP_PORT']),
    ],
    'old' => [
        'label' => 'Old — Local',
        'host'  => $_ENV['DB_OLD_HOST'] ?? '127.0.0.1',
        'user'  => $_ENV['DB_OLD_USER'] ?? 'root',
        'pass'  => $_ENV['DB_OLD_PASS'] ?? '',
        'name'  => $_ENV['DB_OLD_NAME'] ?? 'wp_healthray_old',
        'port'  => (int) ($_ENV['DB_OLD_PORT'] ?? 3306),
    ],
];

/* Default database key used when none is requested or the key is unknown. */
$DEFAULT_DB = 'landing';

/**
 * Open a mysqli connection for the given database key.
 * Unknown keys fall back to the default database, so callers can pass
 * untrusted input safely — only databases declared above are reachable.
 */
function db_connect($key = null)
{
    global $DATABASES, $DEFAULT_DB;

    if (!is_string($key) || !isset($DATABASES[$key])) {
        $key = $DEFAULT_DB;
    }
    $cfg = $DATABASES[$key];

    $conn = new mysqli($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name'], $cfg['port']);
    if ($conn->connect_error) {
        die("Connection failed ({$key}): " . $conn->connect_error);
    }
    return $conn;
}

/**
 * Resolve which database a page should use, in priority order:
 *   1. $ACTIVE_DB set in PHP before requiring this file (explicit override)
 *   2. ?db= in the query string or a "db" POST field
 *   3. the "db" cookie (a selection that sticks across every page/folder)
 *   4. the default database
 * Unknown keys are ignored by db_connect(), so this is safe with raw input.
 */
function db_resolve_key()
{
    global $ACTIVE_DB, $DATABASES, $DEFAULT_DB;

    foreach ([$ACTIVE_DB ?? null, $_GET['db'] ?? null, $_POST['db'] ?? null, $_COOKIE['db'] ?? null] as $candidate) {
        if (is_string($candidate) && isset($DATABASES[$candidate])) {
            return $candidate;
        }
    }
    return $DEFAULT_DB;
}

/*
 * Backward-compatible default connection — every page that does
 * `require conn.php` automatically honours the resolved database above.
 * To force a specific DB regardless of request, set $ACTIVE_DB = 'old';
 * before requiring this file.
 */
$conn = db_connect(db_resolve_key());
