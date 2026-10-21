<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\AppPaths;

/**
 * Asset files under storage/ (projet.md D13, 11.3):
 * storage/assets/{ab}/{cd}/{uuid}.{ext} and {uuid}_thumb.webp|png; temporary files in storage/tmp;
 * background job files (pack archives) in storage/jobs.
 */
final class AssetStorage
{
    public const THUMB_TYPES = ['webp' => 'image/webp', 'png' => 'image/png'];

    public function __construct(private AppPaths $paths)
    {
    }

    public static function newUuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $hex = bin2hex($b);

        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-'
            . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
    }

    public static function isUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $value) === 1;
    }

    public function root(): string
    {
        return $this->paths->storage;
    }

    public function assetsDir(): string
    {
        return $this->paths->storage . '/assets';
    }

    public function tmpDir(): string
    {
        return $this->ensureDir($this->paths->storage . '/tmp');
    }

    public function jobsDir(): string
    {
        return $this->ensureDir($this->paths->storage . '/jobs');
    }

    /**
     * New unique path in storage/tmp (nothing created).
     */
    public function newTmpPath(string $suffix = ''): string
    {
        return $this->tmpDir() . '/' . bin2hex(random_bytes(12)) . $suffix;
    }

    public function newWorkDir(): string
    {
        $dir = $this->newTmpPath('.work');
        if (!@mkdir($dir, 0775) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create a work directory in storage/tmp.');
        }

        return $dir;
    }

    public static function relativeDir(string $uuid): string
    {
        return 'assets/' . substr($uuid, 0, 2) . '/' . substr($uuid, 2, 2);
    }

    public function path(string $uuid, string $ext): string
    {
        return $this->paths->storage . '/' . self::relativeDir($uuid) . '/' . $uuid . '.' . $ext;
    }

    public function thumbPath(string $uuid, string $thumbExt): string
    {
        return $this->paths->storage . '/' . self::relativeDir($uuid) . '/' . $uuid . '_thumb.' . $thumbExt;
    }

    /**
     * @return array{path: string, mime: string}|null
     */
    public function findThumb(string $uuid): ?array
    {
        foreach (self::THUMB_TYPES as $ext => $mime) {
            $path = $this->thumbPath($uuid, $ext);
            if (is_file($path)) {
                return ['path' => $path, 'mime' => $mime];
            }
        }

        return null;
    }

    /**
     * Moves $source to $destination, creating the directories.
     */
    public function place(string $source, string $destination): void
    {
        $this->ensureDir(dirname($destination));
        if (!@rename($source, $destination)) {
            if (!@copy($source, $destination)) {
                throw new \RuntimeException('Cannot move a file into storage/assets.');
            }
            @unlink($source);
        }
    }

    public function deleteFiles(string $uuid, string $ext): void
    {
        @unlink($this->path($uuid, $ext));
        foreach (array_keys(self::THUMB_TYPES) as $thumbExt) {
            @unlink($this->thumbPath($uuid, $thumbExt));
        }
    }

    /**
     * Deletes a file or a directory tree (only below storage/).
     */
    public function remove(string $path): void
    {
        if (!str_starts_with($path, $this->paths->storage . '/')) {
            return;
        }
        if (is_dir($path) && !is_link($path)) {
            $items = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST,
            );
            foreach ($items as $item) {
                $item->isDir() && !$item->isLink() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
            }
            @rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            @unlink($path);
        }
    }

    /**
     * Deletes the entries of storage/tmp (or storage/jobs) older than $maxAgeSeconds.
     */
    public function purgeDir(string $which, int $maxAgeSeconds, int $now): int
    {
        $dir = $this->paths->storage . '/' . ($which === 'jobs' ? 'jobs' : 'tmp');
        if (!is_dir($dir)) {
            return 0;
        }
        $count = 0;
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..' || $name[0] === '.' || $name === 'index.php') {
                continue;
            }
            $path = $dir . '/' . $name;
            $mtime = @filemtime($path);
            if ($mtime !== false && $mtime < $now - $maxAgeSeconds) {
                $this->remove($path);
                $count++;
            }
        }

        return $count;
    }

    /**
     * Every file below storage/assets, as uuid => list of absolute paths
     * (key "" for files that do not follow the naming scheme).
     *
     * @return array<string, list<string>>
     */
    public function scanAssetFiles(): array
    {
        $dir = $this->assetsDir();
        $out = [];
        if (!is_dir($dir)) {
            return $out;
        }
        $items = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        foreach ($items as $item) {
            if (!$item->isFile() || str_starts_with($item->getFilename(), '.')) {
                continue;
            }
            $name = $item->getFilename();
            $uuid = preg_match('/^([0-9a-f-]{36})(?:_thumb)?\.[a-z0-9]{2,5}$/D', $name, $m) === 1 ? $m[1] : '';
            $out[$uuid][] = $item->getPathname();
        }

        return $out;
    }

    private function ensureDir(string $dir): string
    {
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create a storage directory.');
        }

        return $dir;
    }
}
