<?php
/**
 * Database bridge. Reuses the shared healthray-sql/conn.php which defines
 * $DATABASES, db_connect(), db_resolve_key() and opens $conn for the DB
 * requested via ?db= / POST db / cookie (unknown keys fall back to default).
 *
 * Must be required AFTER _bootstrap.php (needs json_error()).
 */

$DB_CONNECT_ERROR = null;

try {
    require_once dirname(__DIR__, 2) . '/conn.php';
} catch (Throwable $e) {
    $DB_CONNECT_ERROR = $e->getMessage();
}

/** Abort with a JSON error unless a live mysqli connection is available. */
function require_db(): mysqli
{
    global $conn, $DB_CONNECT_ERROR;
    if (!($conn instanceof mysqli)) {
        json_error(
            'Database connection failed.' . ($DB_CONNECT_ERROR ? ' (' . $DB_CONNECT_ERROR . ')' : ''),
            502
        );
    }
    return $conn;
}
