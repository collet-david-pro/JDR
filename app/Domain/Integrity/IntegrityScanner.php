<?php

declare(strict_types=1);

namespace JDR\Domain\Integrity;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Assets\AssetIntegrity;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Maps\MapAssetRefs;
use JDR\Maps\ChunkCodec;
use JDR\Maps\FogCodec;

/**
 * Integrity check by slices (no job: each call stays within $budget seconds). Steps, in order:
 * users (quota), assets (files), orphans (files without row), maps (references, chunks, fog, revisions).
 * The cursor is opaque (base64 JSON: step + last id).
 */
final class IntegrityScanner
{
    private const STEPS = ['users', 'assets', 'orphans', 'maps'];
    private const CHUNK_BATCH = 200;

    /** Seconds allowed per slice (at least one item is always processed). */
    public float $budget = 3.0;

    public function __construct(
        private Db $db,
        private AssetStorage $storage,
        private AssetIntegrity $assets,
        private MapAssetRefs $refs,
    ) {
    }

    /**
     * @return array{issues: list<Issue>, cursor: ?string, progress: array{done: int, total: int}}
     */
    public function slice(?string $cursor): array
    {
        [$step, $last] = self::decodeCursor($cursor);
        $deadline = microtime(true) + $this->budget;
        $issues = [];
        while ($step !== null) {
            $done = false;
            if ($step === 'orphans') {
                array_push($issues, ...$this->orphans());
                $done = true;
            } else {
                $table = $step === 'users' ? 'users' : ($step === 'assets' ? 'assets' : 'maps');
                while (true) {
                    $rows = $this->db->fetchAll(
                        'SELECT * FROM ' . $this->db->t($table) . ' WHERE `id` > ? ORDER BY `id` LIMIT 25',
                        [$last],
                    );
                    if ($rows === []) {
                        $done = true;
                        break;
                    }
                    foreach ($rows as $row) {
                        $last = (int) $row['id'];
                        array_push($issues, ...match ($step) {
                            'users' => $this->userIssues($row),
                            'assets' => $this->assetIssues($row),
                            default => $this->mapIssues($row),
                        });
                        if (microtime(true) >= $deadline) {
                            break 2;
                        }
                    }
                }
            }
            if (!$done) {
                break;
            }
            $step = self::STEPS[array_search($step, self::STEPS, true) + 1] ?? null;
            $last = 0;
            if (microtime(true) >= $deadline) {
                break;
            }
        }

        return [
            'issues' => $issues,
            'cursor' => $step === null ? null : base64_encode(json_encode(['s' => $step, 'l' => $last], JSON_THROW_ON_ERROR)),
            'progress' => $this->progress($step, $last),
        ];
    }

    /**
     * Issues of one subject, for the fix (null kind filter = all kinds of the subject type).
     *
     * @return list<Issue>
     */
    public function forSubject(string $kind, int|string $key): array
    {
        $byKind = match ($kind) {
            'quota_mismatch' => fn (): array => $this->rowIssues('users', (int) $key, fn (array $r): array => $this->userIssues($r)),
            'missing_file', 'size_mismatch' => fn (): array => $this->assetByUuid((string) $key),
            'orphan_file' => fn (): array => $this->orphans(),
            default => fn (): array => $this->rowIssues('maps', (int) explode(':', (string) $key)[0], fn (array $r): array => $this->mapIssues($r)),
        };

        return array_values(array_filter($byKind(), static fn (Issue $i): bool => $i->kind === $kind));
    }

    /**
     * @return list<Issue>
     */
    public function orphans(): array
    {
        $known = [];
        foreach ($this->db->fetchAll('SELECT `uuid` FROM ' . $this->db->t('assets')) as $r) {
            $known[(string) $r['uuid']] = true;
        }
        $root = $this->storage->root() . '/';
        $out = [];
        foreach ($this->storage->scanAssetFiles() as $uuid => $paths) {
            if ($uuid !== '' && isset($known[$uuid])) {
                continue;
            }
            foreach ($paths as $path) {
                $rel = str_starts_with($path, $root) ? substr($path, strlen($root)) : $path;
                $out[] = new Issue('orphan_file', $rel, 'warning', ['type' => 'file', 'path' => $rel], ['size_bytes' => (int) @filesize($path)]);
            }
        }
        usort($out, static fn (Issue $a, Issue $b): int => $a->key <=> $b->key);

        return $out;
    }

    /**
     * @param array<string, mixed> $row users row
     * @return list<Issue>
     */
    public function userIssues(array $row): array
    {
        $id = (int) $row['id'];
        $actual = $this->assets->actualBytes($id);
        if ($actual === (int) $row['storage_used_bytes']) {
            return [];
        }

        return [new Issue('quota_mismatch', (string) $id, 'warning', ['type' => 'user', 'id' => $id, 'user_id' => $id], [
            'recorded_bytes' => (int) $row['storage_used_bytes'], 'actual_bytes' => $actual,
        ])];
    }

    /**
     * @param array<string, mixed> $row assets row
     * @return list<Issue>
     */
    public function assetIssues(array $row): array
    {
        $problem = $this->assets->assetProblem($row);
        if ($problem === null) {
            return [];
        }
        $uuid = (string) $row['uuid'];
        $subject = ['type' => 'asset', 'id' => (int) $row['id'], 'uuid' => $uuid];
        if ($problem === 'missing') {
            return [new Issue('missing_file', $uuid, 'error', $subject, ['name' => (string) $row['name'], 'in_trash' => $row['deleted_at'] !== null])];
        }
        [$size, $thumb] = $this->assets->assetSizes($row);

        return [new Issue('size_mismatch', $uuid, 'warning', $subject, [
            'recorded_bytes' => (int) $row['size_bytes'] + (int) $row['thumb_size_bytes'], 'actual_bytes' => $size + $thumb,
        ])];
    }

    /**
     * @param array<string, mixed> $row maps row
     * @return list<Issue>
     */
    public function mapIssues(array $row): array
    {
        $mapId = (int) $row['id'];
        $subject = ['type' => 'map', 'id' => $mapId];
        $palette = json_decode((string) $row['palette'], true);
        $palette = is_array($palette) ? $palette : [];
        $issues = [];
        $counts = [];
        $maxRevision = 0;
        $offset = 0;
        $t = $this->db->t('map_chunks');
        while (true) {
            $chunks = $this->db->fetchAll(
                'SELECT `floor_id`, `layer`, `cx`, `cy`, `data`, `revision` FROM ' . $t . ' WHERE `map_id` = ? '
                . 'ORDER BY `floor_id`, `layer`, `cx`, `cy` LIMIT ' . self::CHUNK_BATCH . ' OFFSET ' . $offset,
                [$mapId],
            );
            foreach ($chunks as $chunk) {
                $maxRevision = max($maxRevision, (int) $chunk['revision']);
                try {
                    $raw = ChunkCodec::decode((string) $chunk['data'], (string) $chunk['layer'], count($palette));
                } catch (\Throwable $e) {
                    $key = $mapId . ':' . $chunk['floor_id'] . ':' . $chunk['layer'] . ':' . $chunk['cx'] . ':' . $chunk['cy'];
                    $issues[] = new Issue('undecodable_chunk', $key, 'error', $subject + [
                        'map_id' => $mapId, 'floor_id' => (int) $chunk['floor_id'], 'layer' => (string) $chunk['layer'],
                        'cx' => (int) $chunk['cx'], 'cy' => (int) $chunk['cy'],
                    ], ['reason' => $e instanceof \JDR\Maps\ChunkCodecException ? $e->getMessage() : 'unreadable']);
                    continue;
                }
                MapAssetRefs::addChunk($raw, $palette, $counts);
            }
            if (count($chunks) < self::CHUNK_BATCH) {
                break;
            }
            $offset += self::CHUNK_BATCH;
        }
        foreach ($this->db->fetchAll(
            'SELECT `floor_id`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ?',
            [$mapId],
        ) as $fog) {
            if (FogCodec::decode((string) $fog['data']) === null) {
                $key = $mapId . ':' . $fog['floor_id'] . ':' . $fog['cx'] . ':' . $fog['cy'];
                $issues[] = new Issue('undecodable_fog', $key, 'error', $subject + [
                    'map_id' => $mapId, 'floor_id' => (int) $fog['floor_id'], 'cx' => (int) $fog['cx'], 'cy' => (int) $fog['cy'],
                ]);
            }
        }
        foreach ($this->refs->noteCounts($mapId) as $assetId => $n) {
            $counts[$assetId] = ($counts[$assetId] ?? 0) + $n;
        }
        foreach ($this->refs->imageCounts($mapId) as $assetId => $n) {
            $counts[$assetId] = ($counts[$assetId] ?? 0) + $n;
        }
        $expected = $this->existing($counts);
        $recorded = [];
        $trashed = [];
        foreach ($this->db->fetchAll(
            'SELECT r.`asset_id`, r.`ref_count`, a.`deleted_at` FROM ' . $this->db->t('map_asset_refs') . ' r LEFT JOIN '
            . $this->db->t('assets') . ' a ON a.`id` = r.`asset_id` WHERE r.`map_id` = ?',
            [$mapId],
        ) as $r) {
            $recorded[(int) $r['asset_id']] = (int) $r['ref_count'];
            if ($r['deleted_at'] !== null) {
                $trashed[(int) $r['asset_id']] = true;
            }
        }
        $diff = [];
        foreach ($expected + $recorded as $assetId => $_) {
            $e = $expected[$assetId] ?? 0;
            $r = $recorded[$assetId] ?? 0;
            if ($e !== $r) {
                $diff[] = ['asset_id' => $assetId, 'recorded' => $r, 'expected' => $e];
            }
        }
        if ($diff !== []) {
            $issues[] = new Issue('asset_refs_mismatch', (string) $mapId, 'warning', $subject, ['assets' => $diff]);
        }
        foreach (array_keys($trashed) as $assetId) {
            if (($expected[$assetId] ?? 0) > 0) {
                $issues[] = new Issue('ref_to_deleted_asset', $mapId . ':' . $assetId, 'warning', $subject + ['asset_id' => $assetId], [
                    'asset_id' => $assetId, 'ref_count' => $expected[$assetId],
                ]);
            }
        }
        $maxRevision = max($maxRevision, (int) $this->db->fetchValue(
            'SELECT COALESCE(MAX(`revision`), 0) FROM ' . $this->db->t('map_versions') . ' WHERE `map_id` = ?',
            [$mapId],
        ));
        if ($maxRevision > (int) $row['revision']) {
            $issues[] = new Issue('revision_ahead', (string) $mapId, 'error', $subject, [
                'map_revision' => (int) $row['revision'], 'max_revision' => $maxRevision,
            ]);
        }

        return $issues;
    }

    /**
     * Expected refs of a map (what the fix writes): counts kept for the assets that exist.
     *
     * @return array<int, int>
     */
    public function expectedRefs(int $mapId): array
    {
        $row = $this->db->fetchOne('SELECT `palette` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$mapId]);
        $palette = $row === null ? [] : json_decode((string) $row['palette'], true);
        $palette = is_array($palette) ? $palette : [];
        $counts = [];
        foreach ($this->db->fetchAll(
            'SELECT `layer`, `data` FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ?',
            [$mapId],
        ) as $chunk) {
            try {
                MapAssetRefs::addChunk(ChunkCodec::decode((string) $chunk['data'], (string) $chunk['layer'], count($palette)), $palette, $counts);
            } catch (\Throwable) {
                continue;
            }
        }
        foreach ($this->refs->noteCounts($mapId) as $assetId => $n) {
            $counts[$assetId] = ($counts[$assetId] ?? 0) + $n;
        }
        foreach ($this->refs->imageCounts($mapId) as $assetId => $n) {
            $counts[$assetId] = ($counts[$assetId] ?? 0) + $n;
        }

        return $this->existing($counts);
    }

    /**
     * @param array<int, int> $counts
     * @return array<int, int> the entries whose asset exists
     */
    private function existing(array $counts): array
    {
        $counts = array_filter($counts, static fn (int $n): bool => $n > 0);
        $out = [];
        foreach (array_chunk(array_keys($counts), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id` FROM ' . $this->db->t('assets') . ' WHERE `id` IN (' . implode(', ', array_fill(0, count($batch), '?')) . ')',
                $batch,
            );
            foreach ($rows as $r) {
                $out[(int) $r['id']] = $counts[(int) $r['id']];
            }
        }
        ksort($out);

        return $out;
    }

    /**
     * @param callable(array<string, mixed>): list<Issue> $check
     * @return list<Issue>
     */
    private function rowIssues(string $table, int $id, callable $check): array
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t($table) . ' WHERE `id` = ?', [$id]);

        return $row === null ? [] : $check($row);
    }

    /**
     * @return list<Issue>
     */
    private function assetByUuid(string $uuid): array
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('assets') . ' WHERE `uuid` = ?', [$uuid]);

        return $row === null ? [] : $this->assetIssues($row);
    }

    /**
     * @return array{done: int, total: int}
     */
    private function progress(?string $step, int $last): array
    {
        $users = (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('users'));
        $assets = (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('assets'));
        $maps = (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('maps'));
        $total = $users + $assets + 1 + $maps;
        if ($step === null) {
            return ['done' => $total, 'total' => $total];
        }
        $before = ['users' => 0, 'assets' => $users, 'orphans' => $users + $assets, 'maps' => $users + $assets + 1][$step];
        $inStep = $step === 'orphans' ? 0 : (int) $this->db->fetchValue(
            'SELECT COUNT(*) FROM ' . $this->db->t($step) . ' WHERE `id` <= ?',
            [$last],
        );

        return ['done' => min($total, $before + $inStep), 'total' => $total];
    }

    /**
     * @return array{0: ?string, 1: int}
     */
    private static function decodeCursor(?string $cursor): array
    {
        if ($cursor === null || $cursor === '') {
            return [self::STEPS[0], 0];
        }
        $data = json_decode((string) base64_decode($cursor, true), true);
        if (!is_array($data) || !in_array($data['s'] ?? null, self::STEPS, true) || !is_int($data['l'] ?? null) || $data['l'] < 0) {
            throw new \InvalidArgumentException('bad cursor');
        }

        return [$data['s'], $data['l']];
    }
}
