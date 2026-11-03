<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\GoneException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Response;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Support\AppPaths;
use JDR\Domain\Update\UpdateStorage;

/**
 * Temporary files of the backup module, below storage/backup-tmp: no backup is kept on the server.
 * - files/<work>/   one backup being built (job db_backup / assets_backup) or an assets archive being restored;
 * - uploads/<id>/   a backup file being sent by the admin (meta.json, data.part);
 * - restore/<id>/   a database restore (state.json, dump.sql.gz).
 * A finished backup is deleted once downloaded, and every leftover at most TTL_SECONDS after its last change.
 */
final class BackupStorage
{
    public const TTL_SECONDS = 3600;
    /** Job types whose result is a one-time download. */
    public const DOWNLOAD_TYPES = ['db_backup' => 'application/gzip', 'assets_backup' => 'application/zip'];

    public function __construct(private AppPaths $paths)
    {
    }

    public function storageDir(): string
    {
        return rtrim($this->paths->storage, '/');
    }

    public function dir(): string
    {
        return $this->ensureDir($this->storageDir() . '/backup-tmp');
    }

    public function filesDir(): string
    {
        return $this->ensureDir($this->dir() . '/files');
    }

    public function uploadsDir(): string
    {
        return $this->ensureDir($this->dir() . '/uploads');
    }

    public function restoreDir(): string
    {
        return $this->ensureDir($this->dir() . '/restore');
    }

    /**
     * Directory of a work id (files/<work>), created on demand.
     */
    public function workDir(mixed $work, bool $create = false): string
    {
        if (!UpdateStorage::isId($work)) {
            throw new \RuntimeException('Invalid backup work id.');
        }
        $dir = $this->filesDir() . '/' . $work;

        return $create ? $this->ensureDir($dir) : $dir;
    }

    /**
     * Removes what is older than TTL_SECONDS: built backups and uploads, finished restores.
     * A restore still running is kept (the site stays in maintenance until it is relaunched).
     */
    public function purge(int $now): int
    {
        $count = 0;
        foreach ([$this->filesDir(), $this->uploadsDir(), $this->restoreDir()] as $base) {
            foreach (scandir($base) ?: [] as $entry) {
                $dir = $base . '/' . $entry;
                if (!UpdateStorage::isId($entry) || !is_dir($dir) || $now - (int) filemtime($dir) <= self::TTL_SECONDS) {
                    continue;
                }
                if ($base === $this->restoreDir()) {
                    $state = self::readJson($dir . '/state.json');
                    if (($state['status'] ?? null) === 'running') {
                        continue;
                    }
                }
                UpdateStorage::removeTree($dir);
                $count++;
            }
        }

        return $count;
    }

    /**
     * GET /jobs/{id}/download of a finished backup: the file is deleted once fully sent.
     */
    public function download(Job $job): Response
    {
        if ($job->status !== Job::DONE) {
            throw new ValidationException('', ['job' => 'not_ready']);
        }
        $file = $job->state['file'] ?? null;
        $work = $job->state['work'] ?? null;
        if (!UpdateStorage::isId($work) || !is_string($file) || preg_match('/^[A-Za-z0-9._-]+$/D', $file) !== 1) {
            throw new GoneException('', [], 'job_expired');
        }
        $dir = $this->workDir($work);
        $path = $dir . '/' . $file;
        if (!is_file($path)) {
            throw new GoneException('', [], 'job_expired');
        }
        $name = is_string($job->result['file_name'] ?? null) ? $job->result['file_name'] : $file;
        $name = (string) preg_replace('/[^A-Za-z0-9._-]/', '_', $name);

        return (new Response('', 200, [
            'Content-Type' => self::DOWNLOAD_TYPES[$job->type] ?? 'application/octet-stream',
            'Content-Length' => (string) filesize($path),
            'Content-Disposition' => 'attachment; filename="' . $name . '"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]))->withFile($path)->afterSend(static function (bool $complete) use ($dir): void {
            if ($complete) {
                UpdateStorage::removeTree($dir);
            }
        });
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function readJson(string $file): ?array
    {
        $raw = is_file($file) ? @file_get_contents($file) : false;
        $data = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($data) ? $data : null;
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function writeJson(string $file, array $data): void
    {
        $tmp = $file . '.tmp';
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (file_put_contents($tmp, $json) === false || !rename($tmp, $file)) {
            throw new \RuntimeException('Cannot write ' . basename($file) . ' (disk full?).');
        }
    }

    private function ensureDir(string $dir): string
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create a backup directory.');
        }

        return $dir;
    }
}
