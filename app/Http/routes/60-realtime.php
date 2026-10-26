<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\RealtimeController;

/*
 * Real time (projet.md 10, contract P6a): long / short polling and SSE.
 * session_close: the session is released before waiting (projet.md 6.4), like /admin/diagnostic/sse.
 */
return static function (Router $r): void {
    $long = ['auth' => true, 'session_close' => true];

    $r->get('/events', [RealtimeController::class, 'events'], $long);
    $r->get('/stream', [RealtimeController::class, 'stream'], $long);
};
