<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\MapLinksController;

/*
 * Maps P9a1: GET /maps/{id}/links, the links between maps (stairs / portals / doors that lead to another
 * map). GM / co-GM of the game (player 403; others 404). Floors, floor ops and change-map: 50-maps.php,
 * 61-sessions.php.
 */
return static function (Router $r): void {
    $r->get('/maps/{id:\d+}/links', [MapLinksController::class, 'show'], ['auth' => true]);
};
