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
        'label' => 'Landing - Live',
        'host'  => $_ENV['DB_HOST'],
        'user'  => $_ENV['DB_USER'],
        'pass'  => $_ENV['DB_PASS'],
        'name'  => $_ENV['DB_NAME'],
        'port'  => (int) $_ENV['DB_PORT'],
    ],
    'botphonic' => [
        'label' => 'Botphonic - Live',
        'host'  => $_ENV['DB_BP_HOST'],
        'user'  => $_ENV['DB_BP_USER'],
        'pass'  => $_ENV['DB_BP_PASS'],
        'name'  => $_ENV['DB_BP_NAME'],
        'port'  => (int) ($_ENV['DB_BP_PORT']),
    ],
];

/* Default database key used when none is requested or the key is unknown. */
$DEFAULT_DB = 'landing';

/**
 * Open a mysqli connection for the given database key.
 * Unknown keys fall back to the default database, so callers can pass
 * untrusted input safely - only databases declared above are reachable.
 */
function db_connect($key = null)
{
    global $DATABASES, $DEFAULT_DB;

    if (!is_string($key) || !isset($DATABASES[$key])) {
        $key = $DEFAULT_DB;
    }
    $cfg = $DATABASES[$key];

    // Remote sites sit ~200ms away and post_content is bulky text, so compress
    // the wire protocol for them; a local server gains nothing from it.
    $isLocal = in_array($cfg['host'], ['127.0.0.1', 'localhost', '::1'], true);
    $conn = mysqli_init();
    // Remote sites reuse this Apache thread's previous connection ("p:" = persistent link). A fresh
    // connect is ~5 round trips (Botphonic: ~1 s); a reused link is reset with COM_CHANGE_USER
    // (~0.4 s), which rolls back any open transaction, releases locks and clears session variables,
    // so nothing carries over from the previous request. Links are per thread (up to ThreadsPerChild
    // = 25 per site), so each request leaves its link with a 5-minute idle timeout (the reset puts the
    // server default of 8 h back) - the live server then drops links nobody is using. Set at the end
    // of the request, not the start, so a long export's quiet gaps between queries can't hit it.
    $host = $isLocal ? $cfg['host'] : 'p:' . $cfg['host'];
    // PHP 8.1+ mysqli throws instead of returning false - catch it, or a failed connection
    // becomes a fatal error whose stack trace prints the host and user name.
    try {
        $ok = @$conn->real_connect($host, $cfg['user'], $cfg['pass'], $cfg['name'], $cfg['port'], null, $isLocal ? 0 : MYSQLI_CLIENT_COMPRESS);
        if ($ok && !$isLocal) {
            register_shutdown_function(function () use ($conn) {
                try { $conn->query('SET SESSION wait_timeout = 300'); } catch (Throwable $e) { /* link already closed / gone */ }
            });
        }
        $err = $ok ? '' : mysqli_connect_error();
    } catch (mysqli_sql_exception $e) {
        $ok = false;
        $err = $e->getMessage();
    }
    if (!$ok) {
        // JSON endpoints set $DB_JSON_ERRORS = true before requiring this file, so the browser gets a
        // readable error instead of plain text. Details go to the PHP error log.
        if (!empty($GLOBALS['DB_JSON_ERRORS'])) {
            error_log("Connection failed ({$key}): " . $err);
            http_response_code(503);
            header('Content-Type: application/json; charset=utf-8');
            $msg = 'Database unreachable - try again in a moment';
            echo json_encode(['status' => 'error', 'error' => $msg, 'success' => false, 'msg' => $msg]);
            exit;
        }
        die("Connection failed ({$key}): " . $err);
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
 * Backward-compatible default connection - every page that does
 * `require conn.php` automatically honours the resolved database above.
 * To force a specific DB regardless of request, set $ACTIVE_DB = 'botphonic';
 * before requiring this file. An endpoint that may not need the database at all
 * sets $DB_NO_AUTOCONNECT = true and calls db_connect() itself when it does.
 */
$conn = empty($DB_NO_AUTOCONNECT) ? db_connect(db_resolve_key()) : null;
