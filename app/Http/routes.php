<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\SystemController;

/*
 * API routes, relative to /api/v1 (projet.md 9.2).
 * Options: auth, csrf, rate, raw_body, maintenance_exempt (see Router).
 */
return static function (Router $r): void {
    $r->get('/health', [SystemController::class, 'health'], ['maintenance_exempt' => true]);
    $r->get('/version', [SystemController::class, 'version'], ['maintenance_exempt' => true]);

    // One file per domain (app/Http/routes/*.php), each returning static function (Router $r): void.
    $files = glob(__DIR__ . '/routes/*.php') ?: [];
    sort($files);
    foreach ($files as $file) {
        (require $file)($r);
    }
};
