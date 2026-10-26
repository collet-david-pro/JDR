<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\Input;
use JDR\Domain\Assets\UploadedFile;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Maps\MapPolicy;
use JDR\Domain\Maps\MapPresenter;
use JDR\Domain\Maps\Transfer\MapExportService;
use JDR\Domain\Maps\Transfer\MapImportService;

/**
 * Map export / import (contract P4c): GET /maps/{id}/export?assets=0|1 and
 * POST /games/{id}/maps/import (multipart: file = JSON or ZIP, client_op_id?).
 * Rights: GM / co-GM of the game (player 403; others 404), checked before the body is looked at.
 */
final class MapTransferController
{
    public function __construct(
        private MapExportService $export,
        private MapImportService $import,
        private MapPresenter $presenter,
        private GamePolicy $games,
        private MapPolicy $maps,
        private AssetStorage $storage,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /maps/{id}/export?assets=0|1 -> application/json document, or application/zip attachment
     */
    public function export(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $mapId = (int) $request->param('id');
        // Rights first: a stranger learns nothing, not even that the parameter is wrong.
        $this->maps->requireEdit($user, $mapId);
        $assets = $request->query['assets'] ?? '0';
        if (!in_array($assets, ['0', '1', ''], true)) {
            throw new ValidationException('', ['assets' => 'invalid']);
        }
        if ($assets === '1') {
            $zip = $this->export->zip($user, $mapId);
            $path = $zip['path'];
            register_shutdown_function(static function () use ($path): void {
                @unlink($path);
            });

            return (new Response('', 200, [
                'Content-Type' => 'application/zip',
                'Content-Disposition' => 'attachment; filename="' . $zip['file_name'] . '"',
                'Content-Length' => (string) filesize($path),
                'X-Content-Type-Options' => 'nosniff',
            ]))->withFile($path);
        }
        $doc = $this->export->json($user, $mapId);

        return new Response($doc['json'], 200, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $doc['file_name'] . '"',
            'Content-Length' => (string) strlen($doc['json']),
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * POST /games/{id}/maps/import (multipart file, client_op_id?) -> 201 {map: Map, missing_assets: [{ref, name}], missing_tokens: [name]}
     */
    public function import(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $game = $this->games->requireEdit($user, (int) $request->param('id'));
        $max = $this->import->maxBytes();
        $length = $request->header('content-length');
        if ($length !== null && ctype_digit($length) && (int) $length > $max + AssetLimits::MULTIPART_MARGIN) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $fields = UploadedFile::fields($request);
        $file = UploadedFile::fromRequest($request, 'file');
        if ($file === null || $file->error === UPLOAD_ERR_NO_FILE) {
            if ($fields === [] && $length !== null && (int) $length > 0 && $this->isMultipart($request)) {
                throw new PayloadTooLargeException('', [], 'file_too_large');
            }
            throw new ValidationException('', ['file' => 'required']);
        }
        if (in_array($file->error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file->size > $max) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        if ($file->error !== UPLOAD_ERR_OK) {
            throw new ValidationException('', ['file' => 'invalid']);
        }
        $clientOpId = $fields['client_op_id'] ?? null;
        if ($clientOpId !== null && (!is_string($clientOpId) || $clientOpId === '')) {
            $clientOpId = $clientOpId === '' ? null : '!';
        }
        $result = is_string($clientOpId) ? $this->import->replay($user, $game, $clientOpId) : null;
        if ($result === null) {
            $tmp = $this->storage->newTmpPath();
            if (!$file->moveTo($tmp)) {
                throw new \RuntimeException('Cannot move the uploaded map to storage/tmp.');
            }
            try {
                $result = $this->import->import($user, $game, $tmp, is_string($clientOpId) ? $clientOpId : null);
            } finally {
                $this->storage->remove($tmp);
            }
        }

        return Response::ok([
            'map' => $this->presenter->full($result['map'], Input::apiBase($request, $this->config)),
            'missing_assets' => $result['missing_assets'],
            'missing_tokens' => $result['missing_tokens'],
        ], [], 201);
    }

    private function isMultipart(Request $request): bool
    {
        return str_starts_with(strtolower((string) $request->header('content-type')), 'multipart/form-data');
    }
}
