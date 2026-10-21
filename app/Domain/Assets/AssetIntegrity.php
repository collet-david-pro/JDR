<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * Integrity of asset storage (acceptance criterion P2 "real size of the files = storage_used_bytes";
 * the admin endpoint and the repair come in P10, projet.md 8.5).
 *
 * check() reports:
 * - quota: users whose storage_used_bytes differs from the real size of the files of their live assets;
 * - missing_files: asset rows (live or in the trash) without their file or thumbnail;
 * - size_mismatches: live assets whose files do not have the recorded size;
 * - orphan_files: files of storage/assets matching no asset row.
 */
final class AssetIntegrity
{
    public function __construct(private Db $db, private AssetStorage $storage)
    {
    }

    /**
     * @return array{ok: bool, quota: list<array{user_id: int, recorded_bytes: int, actual_bytes: int}>,
     *     missing_files: list<string>, size_mismatches: list<string>, orphan_files: list<string>}
     */
    public function check(): array
    {
        $files = $this->storage->scanAssetFiles();
        $orphans = $files[''] ?? [];
        unset($files['']);
        $actualByUser = [];
        $missing = [];
        $sizeMismatches = [];
        $rows = $this->db->fetchAll(
            'SELECT `uuid`, `ext`, `owner_user_id`, `size_bytes`, `thumb_size_bytes`, `deleted_at` FROM ' . $this->db->t('assets'),
        );
        foreach ($rows as $row) {
            $uuid = (string) $row['uuid'];
            unset($files[$uuid]);
            $path = $this->storage->path($uuid, (string) $row['ext']);
            $thumb = $this->storage->findThumb($uuid);
            if (!is_file($path) || $thumb === null) {
                $missing[] = $uuid;
                continue;
            }
            if ($row['deleted_at'] !== null) {
                continue;
            }
            $size = (int) filesize($path);
            $thumbSize = (int) filesize($thumb['path']);
            if ($size !== (int) $row['size_bytes'] || $thumbSize !== (int) $row['thumb_size_bytes']) {
                $sizeMismatches[] = $uuid;
            }
            if ($row['owner_user_id'] !== null) {
                $owner = (int) $row['owner_user_id'];
                $actualByUser[$owner] = ($actualByUser[$owner] ?? 0) + $size + $thumbSize;
            }
        }
        foreach ($files as $paths) {
            array_push($orphans, ...$paths);
        }
        $quota = [];
        foreach ($this->db->fetchAll('SELECT `id`, `storage_used_bytes` FROM ' . $this->db->t('users')) as $user) {
            $id = (int) $user['id'];
            $actual = $actualByUser[$id] ?? 0;
            if ($actual !== (int) $user['storage_used_bytes']) {
                $quota[] = ['user_id' => $id, 'recorded_bytes' => (int) $user['storage_used_bytes'], 'actual_bytes' => $actual];
            }
        }
        $root = $this->storage->root() . '/';
        $orphans = array_map(static fn (string $p): string => str_starts_with($p, $root) ? substr($p, strlen($root)) : $p, $orphans);
        sort($orphans);

        return [
            'ok' => $quota === [] && $missing === [] && $sizeMismatches === [] && $orphans === [],
            'quota' => $quota,
            'missing_files' => $missing,
            'size_mismatches' => $sizeMismatches,
            'orphan_files' => $orphans,
        ];
    }

    /**
     * Real size of the files of the live assets of one user (file + thumbnail).
     */
    public function actualBytes(int $userId): int
    {
        $total = 0;
        $rows = $this->db->fetchAll(
            'SELECT `uuid`, `ext` FROM ' . $this->db->t('assets') . ' WHERE `owner_user_id` = ? AND `deleted_at` IS NULL',
            [$userId],
        );
        foreach ($rows as $row) {
            $path = $this->storage->path((string) $row['uuid'], (string) $row['ext']);
            $thumb = $this->storage->findThumb((string) $row['uuid']);
            $total += (is_file($path) ? (int) filesize($path) : 0) + ($thumb === null ? 0 : (int) filesize($thumb['path']));
        }

        return $total;
    }
}
