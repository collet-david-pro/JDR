<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/*
 * Bootstrap (projet.md 6.1): constants, autoloader, UTC, error handler, config.php.
 * Returns the application (JDR\Core\App), or null under tests (JDR_TESTING).
 */

defined('JDR_ROOT') || define('JDR_ROOT', dirname(__DIR__));

/** Last migration required by this code (compared with settings.db_version). */
defined('REQUIRED_DB_VERSION') || define('REQUIRED_DB_VERSION', '0003');

/** Incremented on every incompatible change of the API/events contract (X-Protocol-Version). */
defined('PROTOCOL_VERSION') || define('PROTOCOL_VERSION', 1);

if (!defined('APP_VERSION')) {
    $jdrVersion = is_file(JDR_ROOT . '/VERSION') ? trim((string) file_get_contents(JDR_ROOT . '/VERSION')) : '';
    define(
        'APP_VERSION',
        preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/', $jdrVersion) === 1 ? $jdrVersion : '0.0.0'
    );
    unset($jdrVersion);
}

require_once __DIR__ . '/autoload.php';

date_default_timezone_set('UTC');
if (function_exists('mb_internal_encoding')) {
    mb_internal_encoding('UTF-8');
}

if (defined('JDR_TESTING')) {
    return null;
}

return \JDR\Core\App::boot(JDR_ROOT);
