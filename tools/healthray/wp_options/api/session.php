<?php
/**
 * GET api/session - auth status + CSRF token.
 * Called by every page on load; also hands the login page its CSRF token.
 */
require_once __DIR__ . '/_bootstrap.php';

if (is_authed()) {
    $_SESSION['last_activity'] = time();
    json_out([
        'success'       => true,
        'authenticated' => true,
        'username'      => $_SESSION['username'] ?? ADMIN_USERNAME,
        'csrf'          => csrf_token(),
        'timeout'       => SESSION_TIMEOUT,
    ]);
}

json_out([
    'success'       => true,
    'authenticated' => false,
    'csrf'          => csrf_token(),
]);
