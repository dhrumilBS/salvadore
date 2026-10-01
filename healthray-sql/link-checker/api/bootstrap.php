<?php
/*
 * Every endpoint's entry point. Resolves which site's database this request
 * targets, connects, loads the lib/ helpers, and defines the small JSON
 * response helpers every endpoint uses.
 *
 * Site selection uses its own cookie ("lc_db"), deliberately separate from
 * any "db"/"dw_db" cookie other tools in this repo use, so switching sites
 * here can never leak into those tools or vice versa.
 */

$ACTIVE_DB = $_GET['db'] ?? $_POST['db'] ?? $_COOKIE['lc_db'] ?? null;
require __DIR__ . '/../conn.php';
require __DIR__ . '/lib/constants.php';
require __DIR__ . '/lib/link_extractor.php';
require __DIR__ . '/lib/link_checker.php';
require __DIR__ . '/lib/query.php';

$DB_KEY = db_resolve_key();
$DB_CFG = db_config($DB_KEY);
$conn   = db_connect($DB_KEY);
$prefix = $DB_CFG['prefix'] ?? 'wp_';

/** Send a JSON response and stop execution. */
function json_out($success, $msg, array $extra = [])
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => $success, 'msg' => $msg] + $extra, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

/** Reject non-POST requests with a 405 + JSON error. */
function require_post_method()
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        json_out(false, 'Invalid request method');
    }
}
