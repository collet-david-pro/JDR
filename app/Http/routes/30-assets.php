<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Router;
use JDR\Http\Controllers\AssetCategoriesController;
use JDR\Http\Controllers\AssetPacksController;
use JDR\Http\Controllers\AssetsController;
use JDR\Http\Controllers\AssetTagsController;
use JDR\Http\Controllers\FilesController;
use JDR\Http\Controllers\JobsController;

/*
 * Assets (projet.md 9.2, contract P2): library, uploads, signed files, categories, tags, packs, user jobs.
 */
return static function (Router $r): void {
    $auth = ['auth' => true];
    $id = '{id:\d+}';
    $upload = $auth + ['rate' => 'upload', 'raw_body' => true];

    $r->get('/assets/limits', [AssetsController::class, 'limits'], $auth);
    $r->get('/assets', [AssetsController::class, 'index'], $auth);
    $r->post('/assets', [AssetsController::class, 'create'], $upload);
    $r->get('/assets/' . $id, [AssetsController::class, 'show'], $auth);
    $r->patch('/assets/' . $id, [AssetsController::class, 'update'], $auth);
    $r->delete('/assets/' . $id, [AssetsController::class, 'delete'], $auth);
    $r->get('/assets/' . $id . '/usages', [AssetsController::class, 'usages'], $auth);
    $r->put('/assets/' . $id . '/favorite', [AssetsController::class, 'favorite'], $auth);
    $r->delete('/assets/' . $id . '/favorite', [AssetsController::class, 'unfavorite'], $auth);

    // Public: the signed URL is the authorization (projet.md 9.3); no session, no lock.
    $r->get('/files/{uuid:[0-9a-f-]+}', [FilesController::class, 'show'], ['session' => false]);

    $r->get('/asset-categories', [AssetCategoriesController::class, 'index'], $auth);
    $r->post('/asset-categories', [AssetCategoriesController::class, 'create'], $auth);
    $r->patch('/asset-categories/' . $id, [AssetCategoriesController::class, 'update'], $auth);
    $r->delete('/asset-categories/' . $id, [AssetCategoriesController::class, 'delete'], $auth);

    $r->get('/asset-tags', [AssetTagsController::class, 'index'], $auth);
    $r->post('/asset-tags', [AssetTagsController::class, 'create'], $auth);
    $r->delete('/asset-tags/' . $id, [AssetTagsController::class, 'delete'], $auth);

    $r->post('/asset-packs/import', [AssetPacksController::class, 'import'], $upload);
    $r->post('/asset-packs/export', [AssetPacksController::class, 'export'], $auth);

    $r->get('/jobs/' . $id, [JobsController::class, 'show'], $auth);
    $r->post('/jobs/' . $id . '/step', [JobsController::class, 'step'], $auth);
    $r->post('/jobs/' . $id . '/cancel', [JobsController::class, 'cancel'], $auth);
    $r->get('/jobs/' . $id . '/download', [JobsController::class, 'download'], $auth);
};
