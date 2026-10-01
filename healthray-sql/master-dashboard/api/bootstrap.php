<?php
/*
 * Every endpoint's entry point. Resolves which site's database this request
 * targets, connects (via the repo-wide ../../conn.php - credentials live in
 * .env, never here), loads the lib/ helpers, and defines the small JSON
 * response helpers every endpoint uses.
 *
 * Site selection uses its own cookie ("md_db"), deliberately NOT the shared
 * "db" cookie other tools on this domain use (e.g. wp_options) - so switching
 * sites here can never leak into those tools, or vice versa.
 */
$ACTIVE_DB = $_GET['db'] ?? $_POST['db'] ?? $_COOKIE['md_db'] ?? 'landing';
require __DIR__ . '/../../conn.php';
require __DIR__ . '/lib/constants.php';
require __DIR__ . '/lib/query.php';
require __DIR__ . '/lib/link_extractor.php';
require __DIR__ . '/lib/link_checker.php';

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
