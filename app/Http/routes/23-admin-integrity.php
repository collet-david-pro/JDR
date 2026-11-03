<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AdminIntegrityController;

/*
 * Integrity tool (role = admin): check by slices, then corrections.
 */
return static function (Router $r): void {
    $admin = ['role' => 'admin'];

    $r->post('/admin/integrity/check', [AdminIntegrityController::class, 'check'], $admin);
    $r->post('/admin/integrity/fix', [AdminIntegrityController::class, 'fix'], $admin);
};
