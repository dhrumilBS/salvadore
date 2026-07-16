<?php
/**
 * conn.php — Server-side DB configuration
 * Credentials are NEVER sent to the frontend.
 * Frontend only sends a db_key string.
 */

$DB_CONFIGS = [
   'healthray' => [
        'label' => 'Healthray',
        'host' => '143.110.176.144',
        'name' => 'wp_healthray_landing',       // ← change to your actual DB name
        'user' => 'office_landing',     // ← change to your actual DB user
        'pass' => 'Health@L@N-DB4({^&*8*U&Jg6J6P', // ← change to your actual password
        'prefix' => 'wp_',
    ],

    'botphonic' => [
        'label' => 'Botphonic',
        'host' => '52.5.152.133',
        'name' => 'wp_botphonic_landing',
        'user' => 'office_landing',
        'pass' => 'BOT@phoL@NDB({^&*U&Jg6J6P',
        'prefix' => 'wp_',
    ],
];

/**
 * Returns a mysqli connection + table prefix for a given key.
 * Dies with JSON error if key is unknown or connection fails.
 */
function getDbConnection(string $key): array
{
    global $DB_CONFIGS;

    if (!isset($DB_CONFIGS[$key])) {
        http_response_code(400);
        die(json_encode(['error' => "Unknown site key: $key"]));
    }

    $cfg = $DB_CONFIGS[$key];
    $conn = new mysqli($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name']);

    if ($conn->connect_error) {
        http_response_code(500);
        die(json_encode(['error' => 'DB connection failed: ' . $conn->connect_error]));
    }

    $conn->set_charset('utf8mb4');
    return ['conn' => $conn, 'prefix' => $cfg['prefix'], 'label' => $cfg['label']];
}

/**
 * Returns site list with only key + label (NO credentials).
 */
function getSiteList(): array
{
    global $DB_CONFIGS;
    $out = [];
    foreach ($DB_CONFIGS as $key => $cfg) {
        $out[] = ['key' => $key, 'label' => $cfg['label']];
    }
    return $out;
}

/**
 * Validate db_key from POST, fall back to first key if missing.
 */
function resolveDbKey(): string
{
    global $DB_CONFIGS;
    $key = trim($_POST['db_key'] ?? '');
    return isset($DB_CONFIGS[$key]) ? $key : array_key_first($DB_CONFIGS);
}