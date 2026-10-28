<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Zip\ZipReader;

/**
 * File operations of an update run, all resumable through an index cursor and bounded by a deadline:
 * plan, backup into rollback/, atomic copy from the archive, removals, hash verification, rollback.
 * Writes: temporary file in the target directory, permissions of the replaced file kept, then rename().
 */
final class UpdateFiles
{
    /**
     * @param \Closure(string): void|null $beforeWrite called before each write or removal of the copy step
     *     (tests use it to simulate a failure)
     */
    public function __construct(private string $root, private string $rollbackDir, private ?\Closure $beforeWrite = null)
    {
    }

    /**
     * write: files of the new release missing on disk or different (updater last, manifest.json at the very end);
     * remove: files of the previous release ($base) absent from the new one and still on disk.
     *
     * @param array<string, string> $new  path => sha256 (updatable files of the new manifest)
     * @param array<string, string> $base path => sha256 (installed manifest, or disk scan)
     * @return array{write: list<string>, remove: list<string>}
     */
    public function plan(array $new, array $base): array
    {
        $write = [];
        foreach ($new as $path => $hash) {
            $file = $this->root . '/' . $path;
            if (!is_file($file) || hash_file('sha256', $file) !== $hash) {
                $write[] = (string) $path;
            }
        }
        $write[] = PackageRules::MANIFEST;
        $remove = [];
        foreach (array_keys($base) as $path) {
            $path = (string) $path;
            if (!isset($new[$path]) && PackageRules::isAllowed($path) && $path !== PackageRules::MANIFEST
                && is_file($this->root . '/' . $path)) {
                $remove[] = $path;
            }
        }
        sort($remove, SORT_STRING);

        return ['write' => PackageRules::copyOrder(array_values(array_unique($write))), 'remove' => $remove];
    }

    /**
     * Every loop below handles at least one item per call (progress is guaranteed), then stops at $deadline.
     *
     * Copies the existing files among $paths into rollback/. Paths absent from disk are appended to $added.
     *
     * @param list<string> $paths
     * @param list<string> $added
     */
    public function backup(array $paths, int $cursor, float $deadline, array &$added): int
    {
        $n = count($paths);
        $start = $cursor;
        for (; $cursor < $n && ($cursor === $start || microtime(true) < $deadline); $cursor++) {
            $path = $paths[$cursor];
            $source = $this->root . '/' . $path;
            if (!is_file($source)) {
                if (!in_array($path, $added, true)) {
                    $added[] = $path;
                }
                continue;
            }
            $target = $this->rollbackDir . '/' . $path;
            self::ensureDir(dirname($target));
            if (!copy($source, $target)) {
                throw new \RuntimeException(UpdateText::t('error.backup_file', ['path' => $path]));
            }
        }

        return $cursor;
    }

    /**
     * Writes $paths from the archive (hash checked again against $hashes; manifest.json is not hashed).
     *
     * @param list<string>          $paths
     * @param array<string, string> $hashes
     */
    public function copy(ZipReader $zip, string $prefix, array $paths, array $hashes, int $cursor, float $deadline): int
    {
        $n = count($paths);
        $start = $cursor;
        for (; $cursor < $n && ($cursor === $start || microtime(true) < $deadline); $cursor++) {
            $path = $paths[$cursor];
            if (!PackageRules::isAllowed($path)) {
                throw new \RuntimeException(UpdateText::t('error.unsafe_target', ['path' => $path]));
            }
            $entry = $zip->find($prefix . $path) ?? throw new \RuntimeException(UpdateText::t('error.missing_in_zip', ['path' => $path]));
            if ($this->beforeWrite !== null) {
                ($this->beforeWrite)($path);
            }
            $target = $this->root . '/' . $path;
            self::ensureDir(dirname($target));
            $tmp = self::tempName($target);
            try {
                $zip->extractTo($entry, $tmp, $entry->size);
                if (isset($hashes[$path]) && hash_file('sha256', $tmp) !== $hashes[$path]) {
                    throw new \RuntimeException(UpdateText::t('error.write_hash', ['path' => $path]));
                }
                $this->install($tmp, $target);
            } finally {
                @unlink($tmp);
            }
        }

        return $cursor;
    }

    /**
     * @param list<string> $paths
     */
    public function remove(array $paths, int $cursor, float $deadline): int
    {
        $n = count($paths);
        $start = $cursor;
        for (; $cursor < $n && ($cursor === $start || microtime(true) < $deadline); $cursor++) {
            $path = $paths[$cursor];
            if (!PackageRules::isAllowed($path) || $path === PackageRules::MANIFEST) {
                continue;
            }
            if ($this->beforeWrite !== null) {
                ($this->beforeWrite)($path);
            }
            $file = $this->root . '/' . $path;
            if (is_file($file) && !unlink($file)) {
                throw new \RuntimeException(UpdateText::t('error.remove_file', ['path' => $path]));
            }
            $this->removeEmptyParents($path);
        }

        return $cursor;
    }

    /**
     * Compares the files on disk with $hashes; mismatching or missing paths are appended to $bad.
     *
     * @param array<string, string> $hashes
     * @param list<string>          $bad
     */
    public function verify(array $hashes, int $cursor, float $deadline, array &$bad): int
    {
        $paths = array_keys($hashes);
        $n = count($paths);
        $start = $cursor;
        for (; $cursor < $n && ($cursor === $start || microtime(true) < $deadline); $cursor++) {
            $path = (string) $paths[$cursor];
            $file = $this->root . '/' . $path;
            if (!is_file($file) || hash_file('sha256', $file) !== $hashes[$path]) {
                $bad[] = $path;
            }
        }

        return $cursor;
    }

    /**
     * Puts the previous files back: $added paths are deleted, the others restored from rollback/.
     * The updater files and manifest.json come last (same order as the copy).
     *
     * @param list<string> $paths written or removed paths
     * @param list<string> $added paths that did not exist before the run
     */
    public function rollback(array $paths, array $added, int $cursor, float $deadline): int
    {
        $paths = PackageRules::copyOrder(array_values(array_unique($paths)));
        $addedSet = array_fill_keys($added, true);
        $n = count($paths);
        $start = $cursor;
        for (; $cursor < $n && ($cursor === $start || microtime(true) < $deadline); $cursor++) {
            $path = $paths[$cursor];
            if (!PackageRules::isAllowed($path)) {
                continue;
            }
            $target = $this->root . '/' . $path;
            if (isset($addedSet[$path])) {
                if (is_file($target) && !unlink($target)) {
                    throw new \RuntimeException(UpdateText::t('error.remove_file', ['path' => $path]));
                }
                $this->removeEmptyParents($path);
                continue;
            }
            $saved = $this->rollbackDir . '/' . $path;
            if (!is_file($saved)) {
                throw new \RuntimeException(UpdateText::t('error.rollback_missing', ['path' => $path]));
            }
            if (is_file($target) && hash_file('sha256', $target) === hash_file('sha256', $saved)) {
                continue;
            }
            self::ensureDir(dirname($target));
            $tmp = self::tempName($target);
            try {
                if (!copy($saved, $tmp)) {
                    throw new \RuntimeException(UpdateText::t('error.restore_file', ['path' => $path]));
                }
                @chmod($tmp, fileperms($saved) & 0777);
                $this->install($tmp, $target, false);
            } finally {
                @unlink($tmp);
            }
        }

        return $cursor;
    }

    /**
     * Moves $tmp over $target (same directory: atomic), keeping the permissions of the replaced file.
     */
    private function install(string $tmp, string $target, bool $keepPerms = true): void
    {
        if ($keepPerms) {
            @chmod($tmp, is_file($target) ? (fileperms($target) & 0777) : 0644);
        }
        if (!rename($tmp, $target)) {
            throw new \RuntimeException(UpdateText::t('error.write_file', ['path' => substr($target, strlen($this->root) + 1)]));
        }
        if (str_ends_with($target, '.php') && function_exists('opcache_invalidate')) {
            @opcache_invalidate($target, true);
        }
    }

    private static function tempName(string $target): string
    {
        return dirname($target) . '/.' . basename($target) . '.jdrupd-' . bin2hex(random_bytes(4));
    }

    private static function ensureDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException(UpdateText::t('error.mkdir', ['path' => $dir]));
        }
    }

    /**
     * Removes the directories left empty by a deletion, never a shipped top directory nor the root.
     */
    private function removeEmptyParents(string $path): void
    {
        $dir = dirname($path);
        while ($dir !== '.' && $dir !== '' && str_contains($dir, '/')) {
            $abs = $this->root . '/' . $dir;
            if (!is_dir($abs) || (scandir($abs) ?: []) !== ['.', '..'] || !@rmdir($abs)) {
                return;
            }
            $dir = dirname($dir);
        }
    }
}
