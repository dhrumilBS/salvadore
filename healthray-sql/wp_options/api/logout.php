<?php
/**
 * POST api/logout — ends the session (CSRF-protected).
 */
require_once __DIR__ . '/_bootstrap.php';

require_post();
require_csrf();

$_SESSION = [];
session_regenerate_id(true);

json_out(['success' => true]);
