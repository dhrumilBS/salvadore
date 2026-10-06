<?php
/**
 * CLI helper: generate a bcrypt hash for ADMIN_PASSWORD_HASH.
 * Usage: php api/_hash.php "your-new-password"
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$password = $argv[1] ?? '';
if ($password === '') {
    fwrite(STDERR, "Usage: php api/_hash.php \"your-new-password\"\n");
    exit(1);
}

echo password_hash($password, PASSWORD_DEFAULT), "\n";
