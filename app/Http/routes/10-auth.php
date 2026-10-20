<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AuthController;
use JDR\Http\Controllers\InvitationController;
use JDR\Http\Controllers\MeController;

/*
 * Authentication and own account (projet.md 9.2). Every non-GET route requires X-CSRF-Token.
 */
return static function (Router $r): void {
    $auth = ['auth' => true];

    $r->get('/auth/me', [AuthController::class, 'me'], ['maintenance_login' => true]);
    $r->post('/auth/register', [AuthController::class, 'register'], ['rate' => 'register']);
    $r->post('/auth/login', [AuthController::class, 'login'], ['rate' => 'login', 'maintenance_login' => true]);
    $r->post('/auth/logout', [AuthController::class, 'logout'], ['maintenance_login' => true]);
    $r->post('/auth/password/forgot', [AuthController::class, 'forgot'], ['rate' => 'forgot']);
    $r->post('/auth/password/reset', [AuthController::class, 'reset']);
    $r->get('/invitations/{code}', [InvitationController::class, 'show']);

    $r->patch('/me', [MeController::class, 'update'], $auth);
    $r->delete('/me', [MeController::class, 'delete'], $auth);
    $r->post('/me/password', [MeController::class, 'password'], $auth);
    $r->put('/me/prefs/{key}', [MeController::class, 'putPref'], $auth);
    $r->get('/me/devices', [MeController::class, 'devices'], $auth);
    $r->delete('/me/devices/{id:\d+}', [MeController::class, 'deleteDevice'], $auth);
    $r->get('/me/storage', [MeController::class, 'storage'], $auth);
    $r->get('/me/export', [MeController::class, 'export'], $auth);
};
