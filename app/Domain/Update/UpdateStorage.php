<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\AppPaths;

/**
 * Locations of the update module and small file helpers.
 *
 * - installation root (code + manifest.json): AppPaths::codeRoot
 * - storage/updates/uploads/<upload_id>/{meta.json,data.part}: chunked uploads in progress
 * - storage/updates/<id>/package.zip + package.json: the validated package waiting to be installed
 * - storage/updates/<id>/state.json (+ lock, rollback/): an update run (see UpdateRunner)
 * - storage/backups/jdr-<timestamp>-v<version>.sql.gz: database backups
 */
final class UpdateStorage
{
    public const TTL_SECONDS = 86400;
    /** Run states that forbid another upload / start (see UpdateRunner). */
    public const BUSY_STATES = ['running', 'rolling_back', 'failed_migration', 'restoring'];

    public function __construct(private AppPaths $paths)
    {
    }

    public static function for(string $root, string $storage): self
    {
        return new self(new AppPaths($root, $storage, $root));
    }

    public function root(): string
    {
        return rtrim($this->paths->codeRoot, '/');
    }

    public function dir(): string
    {
        return $this->ensureDir($this->paths->storage . '/updates');
    }

    public function uploadsDir(): string
    {
        return $this->ensureDir($this->dir() . '/uploads');
    }

    public function runDir(string $id): string
    {
        if (!self::isId($id)) {
            throw new \InvalidArgumentException('Invalid update id.');
        }

        return $this->dir() . '/' . $id;
    }

    public function backupsDir(): string
    {
        return $this->ensureDir($this->paths->storage . '/backups');
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(16));
    }

    public static function isId(mixed $id): bool
    {
        return is_string($id) && preg_match('/^[0-9a-f]{32}$/', $id) === 1;
    }

    /**
     * Ids of the directories under storage/updates (packages and runs), most recent first.
     *
     * @return list<string>
     */
    public function ids(): array
    {
        $out = [];
        foreach (scandir($this->dir()) ?: [] as $entry) {
            if (self::isId($entry) && is_dir($this->dir() . '/' . $entry)) {
                $out[$entry] = (int) filemtime($this->dir() . '/' . $entry);
            }
        }
        arsort($out);

        return array_keys($out);
    }

    /**
     * The run that blocks any other update (started and not finished), or null.
     *
     * @return array<string, mixed>|null state.json
     */
    public function busyRun(): ?array
    {
        foreach ($this->ids() as $id) {
            $state = $this->readJson($this->dir() . '/' . $id . '/state.json');
            if ($state !== null && in_array($state['state'] ?? null, self::BUSY_STATES, true)) {
                return $state;
            }
        }

        return null;
    }

    /**
     * Most recent run (any state), or null.
     *
     * @return array<string, mixed>|null state.json
     */
    public function latestRun(): ?array
    {
        foreach ($this->ids() as $id) {
            $state = $this->readJson($this->dir() . '/' . $id . '/state.json');
            if ($state !== null) {
                return $state;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function readJson(string $file): ?array
    {
        if (!is_file($file)) {
            return null;
        }
        $data = json_decode((string) file_get_contents($file), true);

        return is_array($data) ? $data : null;
    }

    /**
     * Atomic write (temporary file in the same directory, then rename).
     *
     * @param array<string, mixed> $data
     */
    public function writeJson(string $file, array $data): void
    {
        $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
        $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false || !rename($tmp, $file)) {
            @unlink($tmp);
            throw new \RuntimeException('Cannot write ' . basename($file) . '.');
        }
        touch(dirname($file));
    }

    /**
     * Removes old leftovers: uploads, pending packages and finished runs not touched for 24 h.
     * Runs still in progress (or waiting for a decision after a failed migration) are kept.
     */
    public function purge(int $now): void
    {
        foreach (scandir($this->uploadsDir()) ?: [] as $entry) {
            $dir = $this->uploadsDir() . '/' . $entry;
            if (self::isId($entry) && is_dir($dir) && $now - (int) filemtime($dir) > self::TTL_SECONDS) {
                self::removeTree($dir);
            }
        }
        foreach ($this->ids() as $id) {
            $dir = $this->dir() . '/' . $id;
            $state = $this->readJson($dir . '/state.json');
            $finished = $state === null || in_array($state['state'] ?? null, ['done', 'failed', 'restored'], true);
            if ($finished && $now - (int) filemtime($dir) > self::TTL_SECONDS) {
                self::removeTree($dir);
            }
        }
    }

    public static function removeTree(string $dir): void
    {
        if (is_link($dir) || is_file($dir)) {
            @unlink($dir);

            return;
        }
        if (!is_dir($dir)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            /** @var \SplFileInfo $item */
            $item->isDir() && !$item->isLink() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($dir);
    }

    private function ensureDir(string $dir): string
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create ' . $dir . '.');
        }

        return $dir;
    }
}
