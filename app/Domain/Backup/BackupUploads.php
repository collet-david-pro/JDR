<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\NotFoundException;
use JDR\Domain\Update\UpdateStorage;

/**
 * Chunked upload of a backup file to restore (same protocol as the update archive, UploadStore):
 * create {kind, size, sha256?}, PUT raw chunks at an explicit offset (a chunk can be sent again),
 * then take() checks the size (and the SHA-256 when one was given) and hands the file over.
 * The whole-file hash is optional: browsers cannot hash 1 GiB incrementally, and both formats carry
 * their own checks (gzip CRC and the "-- end" line, ZIP CRC and the SHA-256 of manifest-assets.json).
 * storage/backup-tmp/uploads/<upload_id>/{meta.json, data.part}.
 */
final class BackupUploads
{
    public const MAX_BYTES = ['db' => 536870912, 'assets' => 1073741824];

    public function __construct(private BackupStorage $storage, private Clock $clock)
    {
    }

    /**
     * @return array{upload_id:string}
     */
    public function create(string $kind, int $size, ?string $sha256, int $userId): array
    {
        $max = self::MAX_BYTES[$kind] ?? 0;
        if ($size < 1 || $size > $max) {
            throw new BackupException('backup.too_large', ['max_bytes' => $max]);
        }
        $this->storage->purge($this->clock->timestamp());
        $id = UpdateStorage::newId();
        $dir = $this->storage->uploadsDir() . '/' . $id;
        if (!mkdir($dir, 0755) || file_put_contents($dir . '/data.part', '') === false) {
            throw new \RuntimeException('Cannot create the upload directory.');
        }
        BackupStorage::writeJson($dir . '/meta.json', [
            'kind' => $kind,
            'size' => $size,
            'sha256' => $sha256 === null ? null : strtolower($sha256),
            'user_id' => $userId,
            'created_at' => $this->clock->timestamp(),
        ]);

        return ['upload_id' => $id];
    }

    /**
     * Writes $data at $offset. offset > received => 409 backup.bad_offset {received}.
     */
    public function append(string $uploadId, int $offset, string $data, int $userId): int
    {
        [$dir, $meta] = $this->open($uploadId, $userId);
        $file = $dir . '/data.part';
        $handle = fopen($file, 'c+b');
        if ($handle === false || !flock($handle, LOCK_EX)) {
            throw new \RuntimeException('Cannot open the upload file.');
        }
        try {
            clearstatcache(true, $file);
            $received = (int) filesize($file);
            if ($offset < 0 || $offset > $received) {
                throw new BackupException('backup.bad_offset', ['received' => $received], 409);
            }
            if ($offset + strlen($data) > (int) $meta['size']) {
                throw new BackupException('backup.too_large', ['max_bytes' => (int) $meta['size']]);
            }
            ftruncate($handle, $offset);
            fseek($handle, $offset);
            if ($data !== '' && fwrite($handle, $data) !== strlen($data)) {
                throw new \RuntimeException('Cannot write the upload chunk (disk full?).');
            }
            fflush($handle);

            return $offset + strlen($data);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
            @touch($dir);
        }
    }

    /**
     * Checks kind, size and hash; returns the path of the received file (removed by discard()).
     */
    public function complete(string $uploadId, string $kind, int $userId): string
    {
        [$dir, $meta] = $this->open($uploadId, $userId);
        if (($meta['kind'] ?? null) !== $kind) {
            throw new BackupException('backup.wrong_kind');
        }
        $file = $dir . '/data.part';
        clearstatcache(true, $file);
        $received = (int) filesize($file);
        if ($received !== (int) $meta['size']) {
            throw new BackupException('backup.upload_incomplete', ['received' => $received, 'size' => (int) $meta['size']], 409);
        }
        if (is_string($meta['sha256'] ?? null) && !hash_equals($meta['sha256'], (string) hash_file('sha256', $file))) {
            $this->discard($uploadId);
            throw new BackupException('backup.upload_hash');
        }

        return $file;
    }

    /**
     * Deletes an uploaded backup archive and its metadata.
     */
    public function discard(string $uploadId): void
    {
        if (UpdateStorage::isId($uploadId)) {
            UpdateStorage::removeTree($this->storage->uploadsDir() . '/' . $uploadId);
        }
    }

    /**
     * @return array{0:string,1:array<string,mixed>}
     */
    private function open(string $uploadId, int $userId): array
    {
        if (!UpdateStorage::isId($uploadId)) {
            throw new NotFoundException();
        }
        $dir = $this->storage->uploadsDir() . '/' . $uploadId;
        $meta = BackupStorage::readJson($dir . '/meta.json');
        if ($meta === null || (int) ($meta['user_id'] ?? 0) !== $userId || !is_file($dir . '/data.part')) {
            throw new NotFoundException();
        }

        return [$dir, $meta];
    }
}
