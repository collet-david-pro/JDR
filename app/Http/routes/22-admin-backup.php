<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AdminBackupController;

/*
 * Backups and restores (role = admin). The restore routes also answer while the site is in maintenance or its
 * database is behind (maintenance_exempt, session kept with session=true). A database restore step is authorized
 * by the restore token instead of the session user (the users table is being replaced, maybe with an older
 * schema): no session, no role, no CSRF header (the token is the secret).
 */
return static function (Router $r): void {
    $admin = ['role' => 'admin'];
    $restore = $admin + ['maintenance_exempt' => true, 'session' => true];

    $r->get('/admin/backup', [AdminBackupController::class, 'show'], $restore);
    $r->post('/admin/backup/jobs', [AdminBackupController::class, 'createJob'], $admin);
    $r->post('/admin/backup/uploads', [AdminBackupController::class, 'createUpload'], $restore);
    $r->put('/admin/backup/uploads/{upload:[0-9a-f]+}', [AdminBackupController::class, 'chunk'], $restore + ['raw_body' => true]);
    $r->post('/admin/backup/restore/db', [AdminBackupController::class, 'restoreDb'], $restore);
    $r->post('/admin/backup/restore/db/{id:[0-9a-f]+}/step', [AdminBackupController::class, 'restoreDbStep'], ['maintenance_exempt' => true, 'csrf' => false]);
    $r->post('/admin/backup/restore/assets', [AdminBackupController::class, 'restoreAssets'], $restore);
};
