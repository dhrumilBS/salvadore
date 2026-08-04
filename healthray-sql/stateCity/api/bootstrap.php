<?php
// This tool has no database switcher of its own - always target the live
// site, regardless of a stray "db" cookie left behind by other tools
// (e.g. wp_options) that share this cookie across the whole domain.
$ACTIVE_DB = 'landing';
require __DIR__ . '/../../conn.php';

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
