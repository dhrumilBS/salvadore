<?php
/**
 * POST api/login - {username, password} (+ CSRF header).
 * Rate-limited per IP; regenerates session id and CSRF token on success.
 */
require_once __DIR__ . '/_bootstrap.php';

require_post();
require_csrf();

$locked = rl_seconds_locked();
if ($locked > 0) {
    json_error(
        'Too many failed attempts. Try again in ' . ceil($locked / 60) . ' minute(s).',
        429,
        ['retry_after' => $locked]
    );
}

$username = trim((string) ($_POST['username'] ?? ''));
$password = (string) ($_POST['password'] ?? '');

if ($username === '' || $password === '') {
    json_error('Username and password are required.', 422);
}

if (hash_equals(ADMIN_USERNAME, $username) && password_verify($password, ADMIN_PASSWORD_HASH)) {
    session_regenerate_id(true); // prevent session fixation

    $_SESSION['logged_in']     = true;
    $_SESSION['username']      = $username;
    $_SESSION['last_activity'] = time();
    $_SESSION['csrf']          = bin2hex(random_bytes(32));

    rl_clear();

    json_out(['success' => true, 'csrf' => $_SESSION['csrf']]);
}

rl_register_failure();
usleep(400000); // slow down brute force

$remaining = LOGIN_MAX_ATTEMPTS - rl_state()['fails'];
json_error(
    'Invalid username or password.' . ($remaining > 0 && $remaining <= 2 ? " {$remaining} attempt(s) left before lockout." : ''),
    401
);
