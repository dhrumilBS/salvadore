<?php

/**
 * Universal database connection for Focus Keyword.
 *
 * Replaces the per-file ternary that used to pick between
 * healthray-sql/conn.php and botphonic-sql/conn.php. Every API now simply:
 *
 *     require __DIR__ . '/conn.php';
 *
 * and gets a ready $conn for whichever database the request asked for,
 * plus $DB_KEY holding the resolved key.
 */

require_once __DIR__ . '/../env.php';

/*
 * ── Available databases ─────────────────────────────────────────────
 * The array key is exactly what the frontend sends as the "conn" field.
 * Add an entry here to expose another database to the UI.
 */
$DATABASES = [
    'healthray' => [
        'label' => 'Healthray',
        'host'  => $_ENV['DB_HEALTHRAY_HOST'] ?? '',
        'user'  => $_ENV['DB_HEALTHRAY_USER'] ?? '',
        'pass'  => $_ENV['DB_HEALTHRAY_PASS'] ?? '',
        'name'  => $_ENV['DB_HEALTHRAY_NAME'] ?? '',
        'port'  => (int) ($_ENV['DB_HEALTHRAY_PORT'] ?? 3306),
    ],
    'botphonic' => [
        'label' => 'Botphonic',
        'host'  => $_ENV['DB_BOTPHONIC_HOST'] ?? '',
        'user'  => $_ENV['DB_BOTPHONIC_USER'] ?? '',
        'pass'  => $_ENV['DB_BOTPHONIC_PASS'] ?? '',
        'name'  => $_ENV['DB_BOTPHONIC_NAME'] ?? '',
        'port'  => (int) ($_ENV['DB_BOTPHONIC_PORT'] ?? 3306),
    ],
    'local' => [
        'label' => 'Local',
        'host'  => $_ENV['DB_LOCAL_HOST'] ?? '127.0.0.1',
        'user'  => $_ENV['DB_LOCAL_USER'] ?? 'root',
        'pass'  => $_ENV['DB_LOCAL_PASS'] ?? '',
        'name'  => $_ENV['DB_LOCAL_NAME'] ?? '',
        'port'  => (int) ($_ENV['DB_LOCAL_PORT'] ?? 3306),
    ],
];

/* Default database used when none is requested or the key is unknown. */
$DEFAULT_DB = 'healthray';

/**
 * Open a mysqli connection for the given database key.
 * Unknown keys fall back to the default, so untrusted input is safe —
 * only databases declared above are reachable.
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
        http_response_code(500);
        echo json_encode(["status" => "error", "error" => "Connection failed ({$key}): " . $conn->connect_error]);
        exit;
    }
    return $conn;
}

/**
 * Resolve which database the request wants, in priority order:
 *   1. ?db= / "db" POST field   2. "conn" POST/GET field   3. "conn" cookie
 *   4. the default database
 * Unknown keys are ignored by db_connect(), so this is safe with raw input.
 */
function db_resolve_key()
{
    global $DATABASES, $DEFAULT_DB;

    $candidates = [
        $_POST['db']     ?? null,
        $_GET['db']      ?? null,
        $_POST['conn']   ?? null,
        $_GET['conn']    ?? null,
        $_COOKIE['conn'] ?? null,
    ];
    foreach ($candidates as $candidate) {
        if (is_string($candidate) && isset($DATABASES[$candidate])) {
            return $candidate;
        }
    }
    return $DEFAULT_DB;
}

/* Ready-to-use connection + the key that was chosen. */
$DB_KEY = db_resolve_key();
$conn   = db_connect($DB_KEY);
