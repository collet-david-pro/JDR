<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AdminInvitationsController;
use JDR\Http\Controllers\AdminSettingsController;
use JDR\Http\Controllers\AdminSystemController;
use JDR\Http\Controllers\AdminUsersController;

/*
 * Site administration (role = admin): 401 anonymous, 403 for a non-admin.
 */
return static function (Router $r): void {
    $admin = ['role' => 'admin'];

    $r->get('/admin/stats', [AdminSystemController::class, 'stats'], $admin);

    $r->get('/admin/users', [AdminUsersController::class, 'index'], $admin);
    $r->post('/admin/users', [AdminUsersController::class, 'create'], $admin);
    $r->patch('/admin/users/{id:\d+}', [AdminUsersController::class, 'update'], $admin);
    $r->delete('/admin/users/{id:\d+}', [AdminUsersController::class, 'delete'], $admin);
    $r->post('/admin/users/{id:\d+}/suspend', [AdminUsersController::class, 'suspend'], $admin);
    $r->post('/admin/users/{id:\d+}/unsuspend', [AdminUsersController::class, 'unsuspend'], $admin);
    $r->post('/admin/users/{id:\d+}/reset-link', [AdminUsersController::class, 'resetLink'], $admin);

    $r->get('/admin/settings', [AdminSettingsController::class, 'show'], $admin);
    $r->patch('/admin/settings', [AdminSettingsController::class, 'update'], $admin);
    $r->post('/admin/settings/smtp-test', [AdminSettingsController::class, 'smtpTest'], $admin);

    $r->get('/admin/invitations', [AdminInvitationsController::class, 'index'], $admin);
    $r->post('/admin/invitations', [AdminInvitationsController::class, 'create'], $admin);
    $r->delete('/admin/invitations/{id:\d+}', [AdminInvitationsController::class, 'delete'], $admin);

    $r->get('/admin/diagnostic', [AdminSystemController::class, 'diagnostic'], $admin);
    $r->get('/admin/diagnostic/sse', [AdminSystemController::class, 'sse'], $admin + ['session_close' => true]);
    $r->get('/admin/audit', [AdminSystemController::class, 'audit'], $admin);
    $r->get('/admin/migrations', [AdminSystemController::class, 'migrations'], $admin);
};
