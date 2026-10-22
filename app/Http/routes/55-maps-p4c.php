<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\MapThumbnailController;
use JDR\Http\Controllers\MapTransferController;
use JDR\Http\Controllers\MapVersionsController;

/*
 * Maps P4c (projet.md 9.2, contract P4c): versions, export / import, thumbnail.
 * Rights: GM / co-GM of the game (player 403; others 404). The thumbnail files are served by a
 * public route: the signed URL is the authorization (like /files, 9.3).
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $id = '{id:\d+}';
    $map = '/maps/' . $id;
    $upload = $auth + ['rate' => 'upload', 'raw_body' => true];

    $r->get($map . '/versions', [MapVersionsController::class, 'index'], $auth);
    $r->post($map . '/versions', [MapVersionsController::class, 'create'], $auth);
    $r->post($map . '/versions/{vid:\d+}/restore', [MapVersionsController::class, 'restore'], $auth);

    $r->get($map . '/export', [MapTransferController::class, 'export'], $auth);
    $r->post('/games/' . $id . '/maps/import', [MapTransferController::class, 'import'], $upload);

    $r->put($map . '/thumbnail', [MapThumbnailController::class, 'update'], $upload);
    $r->get('/map-thumbs/' . $id, [MapThumbnailController::class, 'show'], ['session' => false]);
};
