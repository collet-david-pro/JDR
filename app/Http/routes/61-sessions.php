<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\SessionActionsController;
use JDR\Http\Controllers\SessionDataController;
use JDR\Http\Controllers\SessionsController;

/*
 * Sessions (projet.md 9.2, contract P6 "Endpoints séances"). Rights: SessionAccess / GamePolicy.
 * POST /sessions/{id}/actions (P6c): SessionActionsController, limited to 30 per second and per
 * user (projet.md 6.4). Joining is limited to 10 per minute and per user.
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $session = '/sessions/{id:\d+}';

    $r->post('/games/{id:\d+}/sessions', [SessionsController::class, 'create'], $auth);
    $r->get('/games/{id:\d+}/sessions', [SessionsController::class, 'index'], $auth);
    $r->post('/sessions/join', [SessionsController::class, 'join'], $auth + ['rate' => 'join']);

    $r->get($session, [SessionsController::class, 'show'], $auth);
    $r->patch($session, [SessionsController::class, 'update'], $auth);
    $r->post($session . '/leave', [SessionsController::class, 'leave'], $auth);
    $r->post($session . '/start', [SessionsController::class, 'start'], $auth);
    $r->post($session . '/pause', [SessionsController::class, 'pause'], $auth);
    $r->post($session . '/resume', [SessionsController::class, 'resume'], $auth);
    $r->post($session . '/end', [SessionsController::class, 'end'], $auth);
    $r->post($session . '/regenerate-code', [SessionsController::class, 'regenerateCode'], $auth);
    $r->post($session . '/kick', [SessionsController::class, 'kick'], $auth);
    $r->put($session . '/assignments/{tokenId:\d+}', [SessionsController::class, 'assign'], $auth);
    $r->post($session . '/ready', [SessionsController::class, 'ready'], $auth);
    $r->post($session . '/change-map', [SessionsController::class, 'changeMap'], $auth);
    $r->post($session . '/actions', [SessionActionsController::class, 'apply'], $auth + ['rate' => 'actions']);

    $r->get($session . '/preload', [SessionDataController::class, 'preload'], $auth);
    $r->get($session . '/snapshot', [SessionDataController::class, 'snapshot'], $auth);
    $r->post('/presence', [SessionDataController::class, 'presence'], $auth);
};
