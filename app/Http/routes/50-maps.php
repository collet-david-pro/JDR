<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\MapsController;

/*
 * Maps (projet.md 9.2, contract P4b). Rights: MapPolicy (GM / co-GM; player 403; others 404).
 * Versions, thumbnail, export/import: P4c. GET chunks also serves a projection screen with
 * ?as=display (option display, P7b D7).
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $id = '{id:\d+}';
    $map = '/maps/' . $id;

    $r->get('/games/' . $id . '/maps', [MapsController::class, 'index'], $auth);
    $r->post('/games/' . $id . '/maps', [MapsController::class, 'create'], $auth);
    $r->get($map, [MapsController::class, 'show'], $auth);
    $r->patch($map, [MapsController::class, 'update'], $auth);
    $r->delete($map, [MapsController::class, 'delete'], $auth);
    $r->post($map . '/restore', [MapsController::class, 'restore'], $auth);
    $r->post($map . '/duplicate', [MapsController::class, 'duplicate'], $auth);
    $r->post($map . '/ops', [MapsController::class, 'ops'], $auth);
    $r->get($map . '/chunks', [MapsController::class, 'chunks'], $auth + ['display' => true]);
};
