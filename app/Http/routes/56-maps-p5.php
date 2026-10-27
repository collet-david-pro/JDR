<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\MapSceneController;

/*
 * Maps P5 (etapes/P05 "Contrat d'API P5"): fog of a floor (read, reset) and objects by bounding
 * box. The object / placed-token / fog ops go through POST /maps/{id}/ops (50-maps.php).
 * Rights: GM / co-GM of the game (player 403; others 404). GET fog also serves a projection screen
 * with ?as=display (option display, P7b D7).
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $map = '/maps/{id:\d+}';

    $r->get($map . '/fog', [MapSceneController::class, 'fog'], $auth + ['display' => true]);
    $r->delete($map . '/fog', [MapSceneController::class, 'clearFog'], $auth);
    $r->get($map . '/objects', [MapSceneController::class, 'objects'], $auth);
};
