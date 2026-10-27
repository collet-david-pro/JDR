<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\DisplayDeviceController;
use JDR\Http\Controllers\DisplaysController;

/*
 * Projection screens (contract P7a). GM side: SessionAccess::requireGm. Device side: public pairing
 * (10 per minute and per IP), then the jdr_display cookie (route option display => 'only').
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $session = '/sessions/{id:\d+}';

    $r->post($session . '/displays', [DisplaysController::class, 'create'], $auth);
    $r->get($session . '/displays', [DisplaysController::class, 'index'], $auth);
    $r->post($session . '/displays/{displayId:\d+}/attach', [DisplaysController::class, 'attach'], $auth);
    $r->patch('/displays/{id:\d+}', [DisplaysController::class, 'update'], $auth);
    $r->delete('/displays/{id:\d+}', [DisplaysController::class, 'destroy'], $auth);
    $r->post('/displays/{id:\d+}/regenerate-code', [DisplaysController::class, 'regenerateCode'], $auth);

    $r->post('/display/pair', [DisplayDeviceController::class, 'pair'], ['rate' => 'pair']);
    $r->get('/display/me', [DisplayDeviceController::class, 'show'], ['display' => 'only']);
    $r->patch('/display/me', [DisplayDeviceController::class, 'update'], ['display' => 'only']);
    $r->post('/display/unpair', [DisplayDeviceController::class, 'unpair'], ['display' => 'only']);
};
