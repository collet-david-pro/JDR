<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetStorage;
use JDR\Zip\ZipException;
use JDR\Zip\ZipLimits;
use JDR\Zip\ZipReader;

/**
 * Format of the assets backup: a ZIP holding storage/assets as is (entries "assets/ab/cd/<uuid>.<ext>" and
 * "<uuid>_thumb.<ext>", stored without compression) and manifest-assets.json
 * {format, version, app_version, created_at, files: [{uuid, path, size, sha256}]}.
 */
final class AssetsArchive
{
    public const MANIFEST = 'manifest-assets.json';
    public const FORMAT = 'jdr-assets-backup';
    public const VERSION = 1;
    public const MAX_MANIFEST_BYTES = 67108864;
    /** Extensions of the original files (AssetImporter) and of the thumbnails (AssetStorage::THUMB_TYPES). */
    public const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

    public static function limits(): ZipLimits
    {
        return new ZipLimits(65535, 4294967295, 1073741824, 100, 65536);
    }

    /**
     * Opens the archive (zip slip, absolute paths and links make ZipReader refuse it) and reads its manifest:
     * path => {size, sha256}.
     *
     * @return array{0:ZipReader, 1:array<string, array{size:int, sha256:string}>}
     */
    public static function open(string $path): array
    {
        try {
            $zip = new ZipReader($path, self::limits());
        } catch (ZipException $e) {
            throw BackupException::invalid('zip_' . $e->reason());
        }
        try {
            $entry = $zip->find(self::MANIFEST);
            $data = $entry === null ? null : json_decode($zip->read($entry, self::MAX_MANIFEST_BYTES), true);
        } catch (ZipException $e) {
            $zip->close();
            throw BackupException::invalid('zip_' . $e->reason());
        }
        if (!is_array($data) || ($data['format'] ?? null) !== self::FORMAT || !is_array($data['files'] ?? null)) {
            $zip->close();
            throw BackupException::invalid('manifest');
        }
        $files = [];
        foreach ($data['files'] as $file) {
            if (is_array($file) && is_string($file['path'] ?? null) && is_int($file['size'] ?? null)
                && is_string($file['sha256'] ?? null) && preg_match('/^[0-9a-f]{64}$/D', $file['sha256']) === 1) {
                $files[$file['path']] = ['size' => $file['size'], 'sha256' => $file['sha256']];
            }
        }

        return [$zip, $files];
    }

    /**
     * True for a path that follows the layout of AssetStorage (relative to storage/).
     */
    public static function isAssetPath(string $name): bool
    {
        if (preg_match('/^assets\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(_thumb)?\.([a-z0-9]{2,5})$/D', $name, $m) !== 1) {
            return false;
        }
        if ($m[1] . $m[2] !== substr($m[3], 0, 4)) {
            return false;
        }

        return $m[4] === '' ? in_array($m[5], self::EXTENSIONS, true) : isset(AssetStorage::THUMB_TYPES[$m[5]]);
    }

    public static function uuidOf(string $name): ?string
    {
        return preg_match('/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_thumb)?\.[a-z0-9]{2,5}$/D', $name, $m) === 1 ? $m[1] : null;
    }
}
