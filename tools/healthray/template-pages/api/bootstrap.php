<?php
// Shared by every endpoint in this tool - require it instead of conn.php.
//
// This tool has no site switcher of its own: it always targets the live
// Healthray site, regardless of a stray "db" cookie left behind by other
// tools (e.g. wp_options) that share that cookie across the whole domain.
// Reads and writes MUST both come through here, or a list could be read from
// one database and its IDs saved into another.
$ACTIVE_DB = 'landing';
require __DIR__ . '/../../conn.php';

const TP_SITE_URL = 'https://healthray.com';
const TP_STATUSES = ['publish', 'draft', 'pending', 'private', 'future', 'trash'];

/** Send a JSON response and stop execution. */
function json_out($success, $msg, array $extra = [])
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => $success, 'msg' => $msg] + $extra, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

/**
 * Writes only from this tool's own page. There is no login, so this is what
 * stops another website open in the browser from POSTing here: app.js sends
 * the X-Template-Pages header (a cross-site form can't), and the browser's
 * Origin / Sec-Fetch-Site must say same-origin when present.
 */
function require_same_origin()
{
    $fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $originHost = $origin !== '' ? parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : '') : '';
    $ok = ($_SERVER['HTTP_X_TEMPLATE_PAGES'] ?? '') === '1'
        && ($fetchSite === '' || $fetchSite === 'same-origin')
        && ($origin === '' || strcasecmp($originHost, $_SERVER['HTTP_HOST'] ?? '') === 0);
    if (!$ok) {
        http_response_code(403);
        json_out(false, 'Request refused - open this tool\'s own page to make changes.');
    }
}

/** Reject non-POST / cross-site requests with a JSON error. */
function require_post_method()
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        json_out(false, 'Invalid request method');
    }
    require_same_origin();
}

/** Validate one row sent by the page; returns [id, title, slug, status] or an error string. */
function tp_clean_row(array $p)
{
    $id = (int) ($p['id'] ?? 0);
    if ($id <= 0) return 'A row had an invalid ID';
    $title = trim((string) ($p['post_title'] ?? ''));
    $slug = trim((string) ($p['post_name'] ?? ''));
    $status = (string) ($p['post_status'] ?? '');
    if ($title === '') return "#$id: title can't be empty";
    if ($slug === '' || !preg_match('/^[a-z0-9\-_%]+$/i', $slug)) return "#$id: slug may only contain letters, numbers, - and _";
    if (!in_array($status, TP_STATUSES, true)) return "#$id: unknown status \"$status\"";
    return [$id, $title, strtolower($slug), $status];
}

/** Prepared UPDATE for one page; pages only, so a stray ID can't touch a post or menu item. */
function tp_update_stmt(mysqli $conn)
{
    $stmt = $conn->prepare("UPDATE wp_posts SET post_title = ?, post_name = ?, post_status = ? WHERE ID = ? AND post_type = 'page'");
    if (!$stmt) json_out(false, 'Prepare failed: ' . $conn->error);
    return $stmt;
}
