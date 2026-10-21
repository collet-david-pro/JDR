<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetPolicy;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\Input;
use JDR\Domain\Assets\Packs\PackService;
use JDR\Domain\Assets\UploadedFile;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Support\Validator;

/**
 * /asset-packs/import (multipart file=zip, scope?) and /asset-packs/export {asset_ids?, category_id?}
 * -> 202 {job}; the browser then drives the job with POST /jobs/{id}/step.
 */
final class AssetPacksController
{
    public function __construct(
        private PackService $packs,
        private AssetLimits $limits,
        private AssetStorage $storage,
        private AssetPolicy $policy,
    ) {
    }

    public function import(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $max = $this->limits->maxPackBytes();
        $length = $request->header('content-length');
        if ($length !== null && ctype_digit($length) && (int) $length > $max + AssetLimits::MULTIPART_MARGIN) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $fields = UploadedFile::fields($request);
        $file = UploadedFile::fromRequest($request, 'file');
        $v = new Validator($fields);
        $scope = $v->in('scope', [Asset::SCOPE_PERSONAL, Asset::SCOPE_GENERAL], false) ?? Asset::SCOPE_PERSONAL;
        if ($file === null || $file->error === UPLOAD_ERR_NO_FILE) {
            if ($fields === [] && $length !== null && (int) $length > 0) {
                throw new PayloadTooLargeException('', [], 'file_too_large');
            }
            $v->error('file', 'required');
        }
        $v->validate();
        assert($file !== null);
        if (in_array($file->error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file->size > $max) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        if ($file->error !== UPLOAD_ERR_OK) {
            throw new ValidationException('', ['file' => 'invalid']);
        }
        $owner = $this->policy->ownerFor($user, $scope);
        $zipName = bin2hex(random_bytes(12)) . '.zip';
        if (!$file->moveTo($this->storage->jobsDir() . '/' . $zipName)) {
            throw new \RuntimeException('Cannot move the uploaded pack to storage/jobs.');
        }
        $job = $this->packs->createImport($user, $zipName, $owner);

        return Response::ok(['job' => $job->toPublic()], [], 202);
    }

    public function export(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $ids = null;
        $category = null;
        try {
            if ($v->raw('asset_ids') !== null) {
                $ids = Input::ids($v->raw('asset_ids'), 'asset_ids', PackService::MAX_ASSETS);
            }
        } catch (ValidationException) {
            $v->error('asset_ids', 'invalid');
        }
        try {
            $category = Input::id($v->raw('category_id'), 'category_id');
        } catch (ValidationException) {
            $v->error('category_id', 'invalid');
        }
        $v->validate();
        $job = $this->packs->createExport($user, $ids, $category);

        return Response::ok(['job' => $job->toPublic()], [], 202);
    }
}
