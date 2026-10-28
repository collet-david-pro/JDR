<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Zip\ZipEntry;
use JDR\Zip\ZipException;
use JDR\Zip\ZipLimits;
use JDR\Zip\ZipReader;

/**
 * Full validation of an update archive, before anything is written in the code:
 * readable ZIP within limits, safe and allowed paths only (one common "jdr-…/" folder tolerated),
 * manifest.json present with a semver version, every file listed in the manifest with the right SHA-256
 * and every manifest file present, version strictly above the running one.
 */
final class PackageInspector
{
    public const MAX_BYTES = 104857600;
    public const MAX_ENTRIES = 20000;
    /** Entries above this size are hashed through a temporary file instead of memory. */
    private const MEMORY_HASH_MAX = 8388608;

    public function __construct(private UpdateStorage $storage)
    {
    }

    public static function limits(): ZipLimits
    {
        return new ZipLimits(self::MAX_ENTRIES, 536870912, self::MAX_BYTES, 100, 65536);
    }

    /**
     * @return array{version:string,prefix:string,files:array<string,string>,sha256:string,size:int}
     *     files = updatable files of the new manifest (path => sha256), all present in the archive
     * @throws UpdateException
     */
    public function inspect(string $zipPath, string $currentVersion): array
    {
        $size = is_file($zipPath) ? (int) filesize($zipPath) : 0;
        if ($size > self::MAX_BYTES) {
            throw new UpdateException('update.too_large', ['max_bytes' => self::MAX_BYTES]);
        }
        try {
            $reader = new ZipReader($zipPath, self::limits());
        } catch (ZipException $e) {
            throw self::fromZip($e);
        }
        try {
            $prefix = self::commonPrefix($reader->entries());
            $files = $this->checkPaths($reader, $prefix);
            $manifestEntry = $files[PackageRules::MANIFEST] ?? null;
            if ($manifestEntry === null || $manifestEntry->size > Manifest::MAX_BYTES) {
                throw new UpdateException('update.missing_manifest');
            }
            $manifest = Manifest::fromJson($reader->read($manifestEntry, Manifest::MAX_BYTES));
            if ($manifest === null) {
                throw new UpdateException('update.missing_manifest', ['reason' => 'invalid']);
            }
            $expected = $manifest->updatable();
            unset($files[PackageRules::MANIFEST]);
            foreach ($files as $path => $entry) {
                if (!isset($expected[$path])) {
                    throw new UpdateException('update.file_hash', ['path' => $path, 'reason' => 'unlisted']);
                }
                if (!hash_equals($expected[$path], $this->hashEntry($reader, $entry))) {
                    throw new UpdateException('update.file_hash', ['path' => $path, 'reason' => 'mismatch']);
                }
            }
            foreach (array_keys($expected) as $path) {
                if (!isset($files[$path])) {
                    throw new UpdateException('update.file_hash', ['path' => $path, 'reason' => 'missing']);
                }
            }
        } catch (ZipException $e) {
            throw self::fromZip($e);
        } finally {
            $reader->close();
        }
        if (!Semver::greaterThan($manifest->version, $currentVersion)) {
            throw new UpdateException('update.not_newer', ['version' => $manifest->version, 'current' => $currentVersion]);
        }

        return [
            'version' => $manifest->version,
            'prefix' => $prefix,
            'files' => $expected,
            'sha256' => (string) hash_file('sha256', $zipPath),
            'size' => $size,
        ];
    }

    /**
     * "jdr-v1.2.3/" when every entry lives under that single folder, else "".
     *
     * @param list<ZipEntry> $entries
     */
    public static function commonPrefix(array $entries): string
    {
        $first = null;
        foreach ($entries as $entry) {
            $slash = strpos($entry->name, '/');
            if ($slash === false) {
                return '';
            }
            $segment = substr($entry->name, 0, $slash);
            if ($first !== null && $segment !== $first) {
                return '';
            }
            $first = $segment;
        }
        if ($first === null || preg_match('/^jdr[0-9A-Za-z._-]*$/i', $first) !== 1 || in_array($first, PackageRules::ROOT_DIRS, true)) {
            return '';
        }

        return $first . '/';
    }

    /**
     * @return array<string, ZipEntry> relative path (prefix removed) => file entry
     */
    private function checkPaths(ZipReader $reader, string $prefix): array
    {
        $files = [];
        foreach ($reader->entries() as $entry) {
            $rel = substr($entry->name, strlen($prefix));
            if ($rel === '' || $rel === false) {
                continue; // the common folder itself
            }
            if ($entry->isDir) {
                $dir = rtrim($rel, '/');
                $top = explode('/', $dir)[0];
                if (PackageRules::isProtected($dir) || !PackageRules::isSafe($dir) || !in_array($top, PackageRules::ROOT_DIRS, true)) {
                    throw new UpdateException('update.unsafe_path', ['path' => $rel]);
                }
                continue;
            }
            if (!PackageRules::isAllowed($rel)) {
                throw new UpdateException('update.unsafe_path', ['path' => $rel]);
            }
            $files[$rel] = $entry;
        }

        return $files;
    }

    private function hashEntry(ZipReader $reader, ZipEntry $entry): string
    {
        if ($entry->size <= self::MEMORY_HASH_MAX) {
            return hash('sha256', $reader->read($entry, max(1, $entry->size)));
        }
        $tmp = $this->storage->dir() . '/inspect-' . bin2hex(random_bytes(6));
        try {
            $reader->extractTo($entry, $tmp, $entry->size);

            return (string) hash_file('sha256', $tmp);
        } finally {
            @unlink($tmp);
        }
    }

    private static function fromZip(ZipException $e): UpdateException
    {
        return match ($e->reason()) {
            'unsafe_path', 'symlink' => new UpdateException('update.unsafe_path', ['reason' => $e->reason()]),
            'too_many_entries', 'too_large', 'entry_too_large' => new UpdateException('update.too_large', ['reason' => $e->reason()]),
            default => new UpdateException('update.invalid_zip', ['reason' => $e->reason()]),
        };
    }
}
