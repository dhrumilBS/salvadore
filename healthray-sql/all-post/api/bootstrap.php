<?php
// This tool has no database switcher of its own - always target the live
// site, regardless of a stray "db" cookie left behind by other tools
// (e.g. wp_options) that share this cookie across the whole domain.
$ACTIVE_DB = 'landing';

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';
require __DIR__ . '/inc_link_filters.php';

/** Send a JSON response and stop execution. */
function json_out($success, $msg, array $extra = [])
{
    header('Content-Type: application/json');
    // Substitute any malformed UTF-8 instead of letting json_encode() fail
    // silently (a false return + echo prints nothing, which the client
    // sees as an empty, unparseable "bad server response").
    echo json_encode(['success' => $success, 'msg' => $msg] + $extra, JSON_INVALID_UTF8_SUBSTITUTE);
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
