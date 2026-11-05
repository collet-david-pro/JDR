<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Response;

/**
 * The database backup taken before a successful update, offered for download (nothing is kept for good on the server).
 * Metadata: storage/backups/pre-update.json {file, from, to, finished_at, expires_at, auto}. The file name always
 * comes from this metadata (never from the client). Manual update: gone after the download, at most 1 h after the
 * end of the run. Automatic update (no administrator present): kept until downloaded or discarded, 7 days at most.
 * A failed run registers nothing: its backup stays for the rollback / restoration.
 */
final class PreUpdateBackup
{
    public const MANUAL_TTL = 3600;
    public const AUTO_TTL = 604800;
    private const META = 'pre-update.json';

    public function __construct(private UpdateStorage $storage)
    {
    }

    /**
     * Records the SQL backup taken before updating from one version to another, and whether the update was automatic.
     */
    public function register(string $file, ?string $from, string $to, int $now, bool $auto = false): void
    {
        $file = basename($file);
        if (preg_match('/^jdr-[0-9A-Za-z.\-_]+\.sql\.gz$/', $file) !== 1 || !is_file($this->storage->backupsDir() . '/' . $file)) {
            return;
        }
        $this->storage->writeJson($this->meta(), [
            'file' => $file, 'from' => $from, 'to' => $to, 'finished_at' => $now,
            'expires_at' => $now + ($auto ? self::AUTO_TTL : self::MANUAL_TTL), 'auto' => $auto,
        ]);
    }

    /**
     * The run was driven by the cron: nobody saw the result, the backup waits longer.
     */
    public function markAuto(): void
    {
        $m = $this->read();
        if ($m !== null) {
            $m['auto'] = true;
            $m['expires_at'] = (int) $m['finished_at'] + self::AUTO_TTL;
            $this->storage->writeJson($this->meta(), $m);
        }
    }

    /**
     * @return array{name:string,size:int,from:?string,to:string,finished_at:int,expires_at:int,auto:bool}|null null when none (expired ones are purged)
     */
    public function status(int $now): ?array
    {
        $this->purge($now);
        $m = $this->read();
        if ($m === null) {
            return null;
        }

        return ['name' => (string) $m['file'], 'size' => (int) @filesize($this->path((string) $m['file'])),
            'from' => is_string($m['from'] ?? null) ? $m['from'] : null, 'to' => (string) ($m['to'] ?? ''),
            'finished_at' => (int) $m['finished_at'], 'expires_at' => (int) $m['expires_at'], 'auto' => ($m['auto'] ?? false) === true];
    }

    /**
     * Removes an expired backup (or metadata pointing to a missing file). Returns the number of files removed.
     */
    public function purge(int $now): int
    {
        $m = $this->read();
        if ($m === null) {
            @unlink($this->meta());

            return 0;
        }
        $file = $this->path((string) $m['file']);
        if (!is_file($file)) {
            @unlink($this->meta());

            return 0;
        }
        if ($now < (int) $m['expires_at']) {
            return 0;
        }
        $this->discard();

        return 1;
    }

    /**
     * Forgets the registered pre-update backup.
     */
    public function discard(): void
    {
        $m = $this->read();
        if ($m !== null) {
            @unlink($this->path((string) $m['file']));
        }
        @unlink($this->meta());
    }

    /**
     * Short-lived proof for the download link: bound to the session CSRF token and to the file.
     */
    public function token(string $csrf, string $name): string
    {
        return substr(hash_hmac('sha256', 'pre-update-backup|' . $name, $csrf), 0, 32);
    }

    /**
     * Download response (the file is deleted once fully sent), or null when there is no valid backup or token.
     */
    public function download(int $now, string $csrf, string $token): ?Response
    {
        $status = $this->status($now);
        if ($status === null || $token === '' || !hash_equals($this->token($csrf, $status['name']), $token)) {
            return null;
        }
        $path = $this->path($status['name']);

        return (new Response('', 200, [
            'Content-Type' => 'application/gzip',
            'Content-Length' => (string) filesize($path),
            'Content-Disposition' => 'attachment; filename="' . $status['name'] . '"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]))->withFile($path)->afterSend(function (bool $complete): void {
            if ($complete) {
                $this->discard();
            }
        });
    }

    private function path(string $file): string
    {
        return $this->storage->backupsDir() . '/' . basename($file);
    }

    private function meta(): string
    {
        return $this->storage->backupsDir() . '/' . self::META;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function read(): ?array
    {
        $m = $this->storage->readJson($this->meta());

        return $m !== null && is_string($m['file'] ?? null) && is_int($m['finished_at'] ?? null) && is_int($m['expires_at'] ?? null) ? $m : null;
    }
}
