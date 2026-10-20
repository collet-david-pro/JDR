<?php

/*
 * Optional real cron (projet.md 6.5): call cron.php?key=<cron_key> every 5 minutes,
 * or from the command line: php cron.php --key=<cron_key>
 */

declare(strict_types=1);

// "defined ||": under "php -S", index.php (router script) already ran in this process.
defined('JDR_BOOT') || define('JDR_BOOT', true);
defined('JDR_ROOT') || define('JDR_ROOT', __DIR__);

/** @var \JDR\Core\App $app */
$app = require __DIR__ . '/app/bootstrap.php';

if (PHP_SAPI === 'cli') {
    $options = getopt('', ['key:']);
    $key = is_array($options) && is_string($options['key'] ?? null) ? $options['key'] : '';
    $status = $app->cron($key);
    fwrite($status === 204 ? STDOUT : STDERR, 'cron: ' . $status . PHP_EOL);
    exit($status === 204 ? 0 : 1);
}

$key = $_GET['key'] ?? ($_SERVER['HTTP_X_CRON_KEY'] ?? '');
$status = $app->cron(is_string($key) ? $key : '');
http_response_code($status);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($status !== 204) {
    header('Content-Type: text/plain; charset=utf-8');
    echo $status === 403 ? 'Forbidden' : 'Service Unavailable';
}
