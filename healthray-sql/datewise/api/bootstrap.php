<?php
/*
 * Which site's database this request targets. Uses its own cookie/param
 * ("dw_db"), deliberately NOT the shared "db" cookie other tools on this
 * domain use (e.g. wp_options) - so switching sites here can never leak
 * into those tools, or vice versa. Falls back to the live site.
 */
$ACTIVE_DB = $_GET['db'] ?? $_POST['db'] ?? $_COOKIE['dw_db'] ?? 'landing';
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';
require __DIR__ . '/lib/constants.php';
require __DIR__ . '/lib/query.php';

$conn->set_charset('utf8mb4');

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
