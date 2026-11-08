<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\PlayerTokensController;

/*
 * Player-made tokens: the personal collection (/me/player-tokens, owner only) and the token a
 * member picks for a game (/games/{id}/my-token).
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $upload = $auth + ['rate' => 'upload', 'raw_body' => true];
    $id = '{id:\d+}';

    $r->get('/me/player-tokens', [PlayerTokensController::class, 'index'], $auth);
    $r->post('/me/player-tokens', [PlayerTokensController::class, 'create'], $upload);
    $r->get('/me/player-tokens/' . $id, [PlayerTokensController::class, 'show'], $auth);
    $r->patch('/me/player-tokens/' . $id, [PlayerTokensController::class, 'rename'], $auth);
    $r->post('/me/player-tokens/' . $id . '/design', [PlayerTokensController::class, 'redesign'], $upload);
    $r->post('/me/player-tokens/' . $id . '/duplicate', [PlayerTokensController::class, 'duplicate'], $auth);
    $r->delete('/me/player-tokens/' . $id, [PlayerTokensController::class, 'delete'], $auth);

    $r->get('/games/' . $id . '/my-token', [PlayerTokensController::class, 'myToken'], $auth);
    $r->put('/games/' . $id . '/my-token', [PlayerTokensController::class, 'choose'], $auth);
};
