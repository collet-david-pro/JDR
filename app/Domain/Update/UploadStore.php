<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\NotFoundException;

/**
 * Chunked upload of an update archive (hosts' upload limits vary): create {size, sha256},
 * append raw chunks at an explicit offset (a chunk can be sent again: the file is cut back to its offset),
 * then complete (size and SHA-256 checked). storage/updates/uploads/<upload_id>/{meta.json, data.part}.
 */
final class UploadStore
{
    public const MAX_BYTES = 104857600;
    public const MAX_CHUNK = 2097152;
    /** Room kept under the PHP limits for headers and multipart framing. */
    public const MARGIN = 65536;

    public function __construct(private UpdateStorage $storage, private Clock $clock)
    {
    }

    /**
     * Chunk size offered to the client: min(2 MiB, PHP limits - margin), at least 64 KiB.
     */
    public static function chunkBytes(?string $uploadMax = null, ?string $postMax = null): int
    {
        $limit = self::MAX_CHUNK;
        foreach ([$uploadMax ?? (string) ini_get('upload_max_filesize'), $postMax ?? (string) ini_get('post_max_size')] as $ini) {
            $bytes = self::iniBytes($ini);
            if ($bytes > 0) {
                $limit = min($limit, $bytes - self::MARGIN);
            }
        }

        return max(65536, $limit);
    }

    /**
     * @return array{upload_id:string,chunk_bytes:int}
     */
    public function create(int $size, string $sha256, int $userId): array
    {
        if ($size < 1 || $size > self::MAX_BYTES) {
            throw new UpdateException('update.too_large', ['max_bytes' => self::MAX_BYTES]);
        }
        $this->storage->purge($this->clock->timestamp());
        $id = UpdateStorage::newId();
        $dir = $this->storage->uploadsDir() . '/' . $id;
        if (!mkdir($dir, 0755) || file_put_contents($dir . '/data.part', '') === false) {
            throw new \RuntimeException('Cannot create the upload directory.');
        }
        $this->storage->writeJson($dir . '/meta.json', [
            'size' => $size,
            'sha256' => strtolower($sha256),
            'user_id' => $userId,
            'created_at' => $this->clock->timestamp(),
        ]);

        return ['upload_id' => $id, 'chunk_bytes' => self::chunkBytes()];
    }

    /**
     * Writes $data at $offset. offset > received => 409 update.bad_offset {received};
     * offset < received => the chunk replaces what followed (replay after a lost answer).
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
                throw new UpdateException('update.bad_offset', ['received' => $received], 409);
            }
            if ($offset + strlen($data) > (int) $meta['size']) {
                throw new UpdateException('update.too_large', ['max_bytes' => (int) $meta['size']]);
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
     * Checks size and hash; returns the path of the received archive (left in place, see discard()).
     */
    public function complete(string $uploadId, int $userId): string
    {
        [$dir, $meta] = $this->open($uploadId, $userId);
        $file = $dir . '/data.part';
        clearstatcache(true, $file);
        $received = (int) filesize($file);
        if ($received !== (int) $meta['size']) {
            throw new UpdateException('update.upload_incomplete', ['received' => $received, 'size' => (int) $meta['size']], 409);
        }
        if (!hash_equals((string) $meta['sha256'], (string) hash_file('sha256', $file))) {
            throw new UpdateException('update.upload_hash');
        }

        return $file;
    }

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
        $meta = $this->storage->readJson($dir . '/meta.json');
        if ($meta === null || (int) ($meta['user_id'] ?? 0) !== $userId || !is_file($dir . '/data.part')) {
            throw new NotFoundException();
        }

        return [$dir, $meta];
    }

    private static function iniBytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || !preg_match('/^(\d+)\s*([kmg]?)/i', $value, $m)) {
            return 0;
        }
        $n = (int) $m[1];

        return match (strtolower($m[2])) {
            'g' => $n * 1073741824,
            'm' => $n * 1048576,
            'k' => $n * 1024,
            default => $n,
        };
    }
}
