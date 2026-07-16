<?php
/**
 * Shared bootstrap for every API endpoint.
 * Hardened session, JSON-only responses, CSRF + auth + rate-limit helpers.
 */

require_once __DIR__ . '/_config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, max-age=0');

/* ── Session (HttpOnly, SameSite=Strict, scoped to the panel path) ── */
if (session_status() === PHP_SESSION_NONE) {
    $panelPath = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\') . '/';
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => $panelPath,
        'domain'   => '',
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

/* ── Accept JSON request bodies transparently ── */
if (
    ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' &&
    stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false
) {
    $decoded = json_decode((string) file_get_contents('php://input'), true);
    if (is_array($decoded)) {
        $_POST = $decoded;
    }
}

/* ── Response helpers ── */
function json_out(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $message, int $code = 400, array $extra = []): void
{
    json_out(['success' => false, 'message' => $message] + $extra, $code);
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        json_error('Method not allowed.', 405);
    }
}

/* ── CSRF ── */
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function require_csrf(): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    if (!is_string($token) || $token === '' || !hash_equals(csrf_token(), $token)) {
        json_error('Invalid or missing CSRF token. Refresh the page and try again.', 403);
    }
}

/* ── Auth ── */
function is_authed(): bool
{
    if (empty($_SESSION['logged_in'])) {
        return false;
    }
    $last = $_SESSION['last_activity'] ?? 0;
    if ($last && (time() - $last) > SESSION_TIMEOUT) {
        // Expired: wipe data but keep a fresh session for the login CSRF token.
        $_SESSION = [];
        session_regenerate_id(true);
        return false;
    }
    return true;
}

function require_auth(): void
{
    if (!is_authed()) {
        json_error('Not authenticated.', 401);
    }
    $_SESSION['last_activity'] = time();
}

/* ── Login rate limiting (per-IP, file-based) ── */
function rl_path(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return sys_get_temp_dir() . '/wpopts_rl_' . hash('sha256', $ip) . '.json';
}

function rl_state(): array
{
    $state = null;
    if (is_file(rl_path())) {
        $state = json_decode((string) file_get_contents(rl_path()), true);
    }
    if (!is_array($state) || !isset($state['fails'], $state['first'])) {
        $state = ['fails' => 0, 'first' => 0];
    }
    if ($state['fails'] > 0 && (time() - $state['first']) > LOGIN_LOCKOUT) {
        $state = ['fails' => 0, 'first' => 0];
    }
    return $state;
}

function rl_seconds_locked(): int
{
    $state = rl_state();
    if ($state['fails'] >= LOGIN_MAX_ATTEMPTS) {
        return max(1, LOGIN_LOCKOUT - (time() - $state['first']));
    }
    return 0;
}

function rl_register_failure(): void
{
    $state = rl_state();
    if ($state['fails'] === 0) {
        $state['first'] = time();
    }
    $state['fails']++;
    file_put_contents(rl_path(), json_encode($state), LOCK_EX);
}

function rl_clear(): void
{
    if (is_file(rl_path())) {
        @unlink(rl_path());
    }
}

/* ── wp_options schema whitelist (shared by search/save/delete) ── */
const WP_OPTION_COLUMNS = ['option_id', 'option_name', 'option_value', 'autoload'];
const MATCH_MODES       = ['contains', 'exact', 'starts', 'ends'];

/** Build a LIKE pattern for a match mode, escaping LIKE wildcards in the value. */
function like_pattern(string $value, string $mode): string
{
    $escaped = addcslashes($value, "\\%_");
    switch ($mode) {
        case 'starts':
            return $escaped . '%';
        case 'ends':
            return '%' . $escaped;
        default: // contains
            return '%' . $escaped . '%';
    }
}
