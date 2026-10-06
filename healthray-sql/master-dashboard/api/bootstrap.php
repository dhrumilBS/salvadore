<?php
/*
 * Every endpoint's entry point. Resolves which site's database this request
 * targets, connects (via the repo-wide ../../conn.php - credentials live in
 * .env, never here), loads the lib/ helpers, and defines the small JSON
 * response helpers every endpoint uses.
 *
 * Site selection: the page pins the site it was opened on and sends it as
 * ?db= on every call (js/common.js api()), so the "md_db" cookie only decides
 * which site a freshly opened page starts on. That cookie is deliberately NOT
 * the shared "db" cookie other tools on this domain use (e.g. wp_options).
 */
$requestedDb = $_GET['db'] ?? $_POST['db'] ?? $_COOKIE['md_db'] ?? 'landing';
$ACTIVE_DB   = is_string($requestedDb) ? $requestedDb : 'landing';
require __DIR__ . '/../../conn.php';
require __DIR__ . '/lib/constants.php';
require __DIR__ . '/lib/query.php';
require __DIR__ . '/lib/link_extractor.php';
require __DIR__ . '/lib/link_checker.php';
require __DIR__ . '/lib/link_editor.php';

// conn.php's db_resolve_key() falls through to the shared "db" cookie for an
// unknown key - that would quietly connect this tool to some other tool's
// site. Pin an unknown key to the default instead.
if (!isset($DATABASES[$ACTIVE_DB])) {
    $ACTIVE_DB = $DEFAULT_DB;
    $conn = db_connect($ACTIVE_DB);
}

$conn->set_charset('utf8mb4');

/** Send a JSON response and stop execution. */
function json_out($success, $msg, array $extra = [])
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => $success, 'msg' => $msg] + $extra, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

/**
 * Only this tool's own pages may trigger a write or an outbound check. This
 * tool has no login, so without this any other website open in the same
 * browser could POST a plain form here and trash posts on a live site.
 * A custom header can't be sent cross-site without a CORS preflight (which
 * this server never grants), and Sec-Fetch-Site / Origin catch the rest.
 */
function require_same_origin()
{
    $fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    $origin    = $_SERVER['HTTP_ORIGIN'] ?? '';
    $originAuthority = '';
    if ($origin !== '') {
        $p = parse_url($origin);
        $originAuthority = ($p['host'] ?? '') . (isset($p['port']) ? ':' . $p['port'] : '');
    }

    $ok = ($_SERVER['HTTP_X_MASTER_DASHBOARD'] ?? '') === '1'
        && ($fetchSite === '' || $fetchSite === 'same-origin')
        && ($origin === '' || strcasecmp($originAuthority, $_SERVER['HTTP_HOST'] ?? '') === 0);

    if (!$ok) {
        http_response_code(403);
        json_out(false, 'Request refused: it did not come from this dashboard.');
    }
}

/** Reject non-POST or cross-site requests with a JSON error. */
function require_post_method()
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        json_out(false, 'Invalid request method');
    }
    require_same_origin();
}

/**
 * fputcsv() for exports: a cell starting with = + - @ (or tab/CR) is run as a
 * formula when the file is opened in Excel/Sheets, and titles, anchor text
 * and meta fields come straight from post content - so prefix those with an
 * apostrophe, which spreadsheets show as plain text.
 */
function dw_csv_write($out, array $cells)
{
    foreach ($cells as &$cell) {
        if (is_string($cell) && $cell !== '' && strpbrk($cell[0], "=+-@\t\r") !== false) {
            $cell = "'" . $cell;
        }
    }
    unset($cell);
    fputcsv($out, $cells);
}
