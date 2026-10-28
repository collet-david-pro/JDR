<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\ProcgenController;

/*
 * Procedural generation (P8): base pack of placeholders (installed lazily in the general library).
 */
return static function (Router $r): void {
    $r->get('/procgen/pack', [ProcgenController::class, 'pack'], ['auth' => true]);
};
