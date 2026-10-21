<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\EncountersController;
use JDR\Http\Controllers\GameMembersController;
use JDR\Http\Controllers\GamesController;
use JDR\Http\Controllers\TokensController;

/*
 * Games, members, tokens, encounters (projet.md 9.2, contract P3). Rights: GamePolicy
 * (non-member 404, member without the right 403).
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $id = '{id:\d+}';
    $game = '/games/' . $id;

    $r->get('/games', [GamesController::class, 'index'], $auth);
    $r->post('/games', [GamesController::class, 'create'], $auth);
    $r->get($game, [GamesController::class, 'show'], $auth);
    $r->patch($game, [GamesController::class, 'update'], $auth);
    $r->delete($game, [GamesController::class, 'delete'], $auth);
    $r->post($game . '/archive', [GamesController::class, 'archive'], $auth);
    $r->post($game . '/restore', [GamesController::class, 'restore'], $auth);

    $r->get($game . '/members', [GameMembersController::class, 'index'], $auth);
    $r->post($game . '/members', [GameMembersController::class, 'create'], $auth);
    $r->patch($game . '/members/{userId:\d+}', [GameMembersController::class, 'update'], $auth);
    $r->delete($game . '/members/{userId:\d+}', [GameMembersController::class, 'delete'], $auth);

    $r->get($game . '/tokens', [TokensController::class, 'index'], $auth);
    $r->post($game . '/tokens', [TokensController::class, 'create'], $auth);
    $r->get('/tokens/' . $id, [TokensController::class, 'show'], $auth);
    $r->patch('/tokens/' . $id, [TokensController::class, 'update'], $auth);
    $r->delete('/tokens/' . $id, [TokensController::class, 'delete'], $auth);

    $r->get($game . '/encounters', [EncountersController::class, 'index'], $auth);
    $r->post($game . '/encounters', [EncountersController::class, 'create'], $auth);
    $r->patch('/encounters/' . $id, [EncountersController::class, 'update'], $auth);
    $r->delete('/encounters/' . $id, [EncountersController::class, 'delete'], $auth);
    $r->post('/encounters/' . $id . '/place', [EncountersController::class, 'place'], $auth);
};
