<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\TemplatesController;

/*
 * Map templates (P9c1): list, save a map as a template, create a map from a template, delete.
 * Rights and visibility: MapTemplates (private: the owner; site: everyone, admin to delete).
 */
return static function (Router $r): void {
    $r->get('/templates', [TemplatesController::class, 'index'], ['auth' => true]);
    $r->post('/maps/{id:\d+}/save-as-template', [TemplatesController::class, 'save'], ['auth' => true]);
    $r->post('/templates/{id:\d+}/instantiate', [TemplatesController::class, 'instantiate'], ['auth' => true]);
    $r->delete('/templates/{id:\d+}', [TemplatesController::class, 'delete'], ['auth' => true]);
};
