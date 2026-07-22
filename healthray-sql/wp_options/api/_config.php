<?php
/**
 * Panel configuration - never served directly (blocked by .htaccess "_" rule).
 *
 * To change the admin password, run from a terminal:
 *   php api/_hash.php "your-new-password"
 * and paste the printed hash into ADMIN_PASSWORD_HASH below.
 */

const ADMIN_USERNAME      = 'healthray';
const ADMIN_PASSWORD_HASH = '$2y$10$iKiFCLeaVuXolO364U5MeemRKqfgDWz6q9TeIsJmCWuV5j7rDTmsO';

const SESSION_NAME    = 'wpopts_sid';
const SESSION_TIMEOUT = 1800;   // 30 minutes of inactivity

const LOGIN_MAX_ATTEMPTS = 5;   // failed attempts before lockout
const LOGIN_LOCKOUT      = 900; // lockout window in seconds (15 min)
