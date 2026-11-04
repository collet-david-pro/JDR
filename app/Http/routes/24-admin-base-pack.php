<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AdminBasePackController;

/*
 * Base pack repair (role = admin).
 */
return static function (Router $r): void {
    $r->post('/admin/base-pack/install', [AdminBasePackController::class, 'install'], ['role' => 'admin']);
};
