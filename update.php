<?php

/*
 * JDR updater (manual assisted update): installs the archive sent from Administration › Update, or finishes
 * an update whose files were sent by FTP (integrity check, database backup, migrations).
 * Reserved to a logged-in administrator; works while the site answers 503 (it bypasses the maintenance check).
 *
 * This file must stay parseable by old PHP versions so that it can explain the problem:
 * no PHP 8 syntax here, everything else lives in app/Domain/Update/.
 */

declare(strict_types=1);

// "defined ||": under "php -S", index.php (router script) already ran in this process.
defined('JDR_BOOT') || define('JDR_BOOT', true);
defined('JDR_ROOT') || define('JDR_ROOT', __DIR__);

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>JDR</title>'
        . '<p>JDR requiert PHP 8.1 ou plus récent (version actuelle : '
        . htmlspecialchars(PHP_VERSION, ENT_QUOTES, 'UTF-8')
        . '). Changez la version de PHP dans le panneau de votre hébergeur.</p>';
    exit;
}
if (!is_file(__DIR__ . '/config.php')) {
    // Not installed: nothing to update.
    header('Location: install.php', true, 303);
    exit;
}

@ini_set('display_errors', '0');
if (function_exists('set_time_limit')) {
    @set_time_limit(120);
}

/** @var \JDR\Core\App|null $jdrApp */
$jdrApp = require __DIR__ . '/app/bootstrap.php';
if (!$jdrApp instanceof \JDR\Core\App || $jdrApp->config() === null) {
    header('Location: install.php', true, 303);
    exit;
}
$jdrRequest = \JDR\Core\Request::fromGlobals($jdrApp->config());
\JDR\Domain\Update\UpdatePage::respond($jdrApp, $jdrRequest)->send($jdrRequest->method !== 'HEAD');
