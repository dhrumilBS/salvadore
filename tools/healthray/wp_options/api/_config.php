<?php
/**
 * Panel configuration - never served directly (blocked by .htaccess "_" rule).
 *
 * To change the admin password, run from a terminal:
 *   php api/_hash.php "admin@123"
 * and paste the printed hash into ADMIN_PASSWORD_HASH below.
 */

const ADMIN_USERNAME      = 'healthray';
const ADMIN_PASSWORD_HASH = '$2y$10$7H6P/7xuvgU1KInAi4K91.1GbSK6eyobwuzEpNAs/7aHA8I62fq9O';

const SESSION_NAME    = 'wpopts_sid';
const SESSION_TIMEOUT = 1800;   // 30 minutes of inactivity

const LOGIN_MAX_ATTEMPTS = 5;   // failed attempts before lockout
const LOGIN_LOCKOUT      = 900; // lockout window in seconds (15 min)
