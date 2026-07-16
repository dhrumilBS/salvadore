<?php

/**
 * Loads the focus-keyword .env exactly once for the whole app.
 *
 * It reuses the Composer autoloader that already ships with healthray-sql
 * (vlucas/phpdotenv), so focus-keyword needs no vendor/ of its own.
 *
 * Both the DB layer (api/conn.php) and the auth gate (auth.php) require
 * this file, so credentials live in a single place.
 */

if (!defined('FK_ENV_LOADED')) {
    require_once __DIR__ . '/../healthray-sql/vendor/autoload.php';

    $dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
    $dotenv->safeLoad();

    define('FK_ENV_LOADED', true);
}
