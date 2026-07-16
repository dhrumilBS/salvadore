<?php

/**
 * Authentication gate for Focus Keyword.
 *
 * A single shared account is configured in .env (APP_USER + APP_PASS, or the
 * stronger APP_PASS_HASH). Sessions keep the user logged in across pages.
 *
 *   - Pages call fk_require_login()    → redirect to login.php if not signed in.
 *   - APIs call  fk_require_api_auth() → 401 JSON if not signed in.
 */

require_once __DIR__ . '/env.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

/** Validate a username/password pair against the configured credentials. */
function fk_attempt_login(string $user, string $pass): bool
{
    $envUser = (string) ($_ENV['APP_USER'] ?? '');
    $hash    = (string) ($_ENV['APP_PASS_HASH'] ?? '');
    $plain   = (string) ($_ENV['APP_PASS'] ?? '');

    if ($envUser === '' || !hash_equals($envUser, $user)) {
        return false;
    }

    // Prefer the hashed password when present; fall back to plain text.
    $ok = $hash !== ''
        ? password_verify($pass, $hash)
        : ($plain !== '' && hash_equals($plain, $pass));

    if ($ok) {
        session_regenerate_id(true);
        $_SESSION['fk_auth'] = true;
        $_SESSION['fk_user'] = $user;
    }
    return $ok;
}

function fk_is_logged_in(): bool
{
    return !empty($_SESSION['fk_auth']);
}

function fk_current_user(): string
{
    return (string) ($_SESSION['fk_user'] ?? '');
}

function fk_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

/** Guard a normal page: bounce to the login screen when not authenticated. */
function fk_require_login(): void
{
    if (!fk_is_logged_in()) {
        header('Location: login.php');
        exit;
    }
}

/** Guard an API endpoint: emit a 401 JSON error when not authenticated. */
function fk_require_api_auth(): void
{
    if (!fk_is_logged_in()) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(["status" => "error", "error" => "Not authenticated. Please log in again."]);
        exit;
    }
}
