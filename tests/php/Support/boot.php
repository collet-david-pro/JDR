<?php

/**
 * Makes the Migrate/Db tests self-sufficient: defines JDR_BOOT and loads the
 * application autoloader when tests/php/bootstrap.php has not done it already.
 */

declare(strict_types=1);

defined('JDR_BOOT') || define('JDR_BOOT', true);

require_once dirname(__DIR__, 3) . '/app/autoload.php';
