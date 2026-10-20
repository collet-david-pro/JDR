<?php

/*
 * JDR front controller: every page and API request (projet.md 6.1).
 * Development: PHP_CLI_SERVER_WORKERS=8 php -S localhost:8000 index.php
 */

declare(strict_types=1);

defined('JDR_BOOT') || define('JDR_BOOT', true);
defined('JDR_ROOT') || define('JDR_ROOT', __DIR__);

// Built-in server (ignores .htaccess): let it serve existing public files itself, before booting,
// so that a served script (cron.php, install.php...) starts clean. Private paths go to the app (403).
if (PHP_SAPI === 'cli-server') {
    require_once __DIR__ . '/app/autoload.php';
    if (\JDR\Core\DevServer::shouldServeStatic(__DIR__, (string) ($_SERVER['REQUEST_URI'] ?? '/'))) {
        return false;
    }
}

/** @var \JDR\Core\App $app */
$app = require __DIR__ . '/app/bootstrap.php';
$app->run();
