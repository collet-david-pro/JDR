<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\HttpException;
use JDR\Core\Logger;
use JDR\Imaging\ImageRejected;

/**
 * Steps 3 to 9 of the import pipeline (projet.md 11.3), shared by uploads and pack imports.
 *
 * The source file must already be in storage/tmp; it is always deleted. Steps:
 * image pipeline (type, dimensions, animation, re-encoding, thumbnail, SHA-256) in a work directory;
 * duplicate of the same owner => existing asset, nothing consumed; else one transaction:
 * owner row locked, duplicate re-checked, atomic quota (file + thumbnail bytes), insertion, tags,
 * files moved to storage/assets/{ab}/{cd}/; on failure, rollback and placed files deleted.
 */
final class AssetImporter
{
    private const EXTENSIONS = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];

    public function __construct(
        private Db $db,
        private ImageProcessor $processor,
        private AssetLimits $limits,
        private AssetStorage $storage,
        private AssetRepository $assets,
        private StorageQuota $quota,
        private TagService $tags,
        private Logger $logger,
    ) {
    }

    /**
     * @throws HttpException rejected image (415 unsupported_type, 413 file_too_large, 422 image_too_large|animation_too_long)
     * @throws \JDR\Core\Errors\PayloadTooLargeException 413 quota_exceeded
     */
    public function import(string $sourcePath, ImportRequest $request): ImportResult
    {
        $work = $this->storage->newWorkDir();
        try {
            try {
                $image = $this->processor->process($sourcePath, $this->limits->imageLimits(), $work);
            } catch (ImageRejected $e) {
                $this->logger->info('Asset rejected', ['reason' => $e->reason(), 'detail' => $e->detail()]);
                // The client only gets the stable code and the generic translated message.
                throw new HttpException($e->status(), $e->errorCode(), '', [], [], $e);
            }
            $ext = self::EXTENSIONS[$image->mime] ?? null;
            $thumbExt = array_search($image->thumbMime, AssetStorage::THUMB_TYPES, true);
            if ($ext === null || !is_string($thumbExt) || !is_file($image->path) || !is_file($image->thumbPath)) {
                throw new \RuntimeException('Image pipeline returned an unexpected result.');
            }
            $duplicate = $this->assets->findDuplicate($request->ownerId, $image->sha256);
            if ($duplicate !== null) {
                return new ImportResult($duplicate, true);
            }
            $size = (int) filesize($image->path);
            $thumbSize = (int) filesize($image->thumbPath);
            $uuid = AssetStorage::newUuid();
            $final = $this->storage->path($uuid, $ext);
            $thumb = $this->storage->thumbPath($uuid, $thumbExt);
            $placed = [];
            try {
                return $this->db->transaction(function () use ($request, $image, $ext, $size, $thumbSize, $uuid, $final, $thumb, &$placed): ImportResult {
                    if ($request->ownerId !== null) {
                        $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('users') . ' WHERE `id` = ? FOR UPDATE', [$request->ownerId]);
                        $duplicate = $this->assets->findDuplicate($request->ownerId, $image->sha256);
                        if ($duplicate !== null) {
                            return new ImportResult($duplicate, true);
                        }
                        $this->quota->reserve($request->ownerId, $size + $thumbSize);
                    }
                    $id = $this->assets->insert([
                        'uuid' => $uuid,
                        'owner_user_id' => $request->ownerId,
                        'category_id' => $request->categoryId,
                        'name' => $request->name,
                        'kind' => $request->kind,
                        'mime' => $image->mime,
                        'ext' => $ext,
                        'width' => $image->width,
                        'height' => $image->height,
                        'is_animated' => $image->isAnimated ? 1 : 0,
                        'frame_count' => max(1, $image->frameCount),
                        'duration_ms' => max(0, $image->durationMs),
                        'size_bytes' => $size,
                        'thumb_size_bytes' => $thumbSize,
                        'sha256' => $image->sha256,
                        'source' => $request->source,
                    ]);
                    if ($request->tags !== []) {
                        $this->assets->setTags($id, $this->tags->resolve($request->ownerId, $request->tags));
                    }
                    foreach ([[$image->path, $final], [$image->thumbPath, $thumb]] as [$from, $to]) {
                        if (!is_file($from) && is_file($to)) {
                            continue; // retried transaction (deadlock): already placed
                        }
                        $this->storage->place($from, $to);
                        $placed[] = $to;
                    }
                    $asset = $this->assets->find($id);
                    if ($asset === null) {
                        throw new \RuntimeException('Inserted asset not found.');
                    }

                    return new ImportResult($asset, false);
                });
            } catch (\Throwable $e) {
                foreach ($placed as $path) {
                    @unlink($path);
                }
                throw $e;
            }
        } finally {
            $this->storage->remove($work);
            $this->storage->remove($sourcePath);
        }
    }
}
