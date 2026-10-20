<?php

/*
 * JDR installer (projet.md 19). Upload the files by FTP, then open install.php in a browser.
 * Locked once installed (config.php or storage/install.lock present); deletes itself at the end.
 *
 * This file must stay parseable by old PHP versions so that it can explain the problem:
 * no PHP 8 syntax here, everything else lives in app/Install/.
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
if (!function_exists('session_start') || !function_exists('random_bytes')) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>JDR</title>'
        . '<p>L\'extension PHP « session » est requise : activez-la dans le panneau de votre hébergeur.</p>';
    exit;
}

require_once __DIR__ . '/app/autoload.php';

date_default_timezone_set('UTC');
if (function_exists('mb_internal_encoding')) {
    mb_internal_encoding('UTF-8');
}
@ini_set('display_errors', '0');

$jdrNonce = \JDR\Core\SecurityHeaders::nonce();
$jdrEnv = \JDR\Install\Env::fromGlobals(JDR_ROOT);
$jdrHeaders = \JDR\Core\SecurityHeaders::headers($jdrNonce, $jdrEnv->isHttps()) + [
    'Cache-Control' => 'no-store',
    'X-Robots-Tag' => 'noindex, nofollow',
];

try {
    $jdrState = \JDR\Install\State::start($jdrEnv);
    $jdrInstaller = new \JDR\Install\Installer($jdrEnv, $jdrState, new \JDR\Install\NativeHttpClient(5), $jdrNonce);
    $jdrReply = $jdrInstaller->handle($_GET, $_POST);
    $jdrState->close();
} catch (\Throwable $jdrError) {
    error_log('JDR install.php: ' . $jdrError->getMessage() . ' @ ' . $jdrError->getFile() . ':' . $jdrError->getLine());
    $jdrReply = \JDR\Install\Reply::html((new \JDR\Install\Page($jdrNonce))->render('message', [
        'message' => \JDR\Install\Strings::t('fatal.text', ['message' => $jdrError->getMessage()]),
    ]), 500);
}
$jdrReply->send($jdrHeaders);
