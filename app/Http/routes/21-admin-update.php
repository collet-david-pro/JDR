<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AdminUpdateController;

/*
 * Manual assisted update (role = admin): check, chunked upload, start. The run itself happens in update.php.
 */
return static function (Router $r): void {
    $admin = ['role' => 'admin'];

    $r->get('/admin/update', [AdminUpdateController::class, 'show'], $admin);
    $r->patch('/admin/update', [AdminUpdateController::class, 'update'], $admin);
    $r->post('/admin/update/check', [AdminUpdateController::class, 'check'], $admin);
    $r->post('/admin/update/uploads', [AdminUpdateController::class, 'createUpload'], $admin);
    $r->put('/admin/update/uploads/{upload:[0-9a-f]+}', [AdminUpdateController::class, 'chunk'], $admin + ['raw_body' => true]);
    $r->post('/admin/update/uploads/{upload:[0-9a-f]+}/complete', [AdminUpdateController::class, 'complete'], $admin);
    $r->delete('/admin/update/pending', [AdminUpdateController::class, 'discard'], $admin);
    $r->post('/admin/update/start', [AdminUpdateController::class, 'start'], $admin);
};
