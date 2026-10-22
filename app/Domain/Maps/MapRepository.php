<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to maps, map_floors, map_chunks, map_asset_refs and processed_ops (projet.md 7.2).
 * JSON columns are opaque for SQL: always encoded/decoded and validated by PHP.
 */
final class MapRepository
{
    public const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;
    public const LIST_LIMIT = 1000;

    /** Columns of maps that update() may write (JSON columns given as PHP values). */
    private const UPDATABLE = [
        'name', 'folder', 'sort_order', 'cell_px', 'width_cells', 'height_cells', 'unit_label',
        'unit_per_cell', 'theme', 'ambient', 'palette', 'layers',
    ];
    private const JSON_COLUMNS = ['ambient', 'palette', 'layers'];

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function db(): Db
    {
        return $this->db;
    }

    public function find(int $id): ?Map
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$id]);

        return $row === null ? null : Map::fromRow($row);
    }

    /**
     * Locks the map row until the end of the transaction (serializes the writers of a map, 11.4).
     */
    public function findForUpdate(int $id): ?Map
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('maps') . ' WHERE `id` = ? FOR UPDATE', [$id]);

        return $row === null ? null : Map::fromRow($row);
    }

    /**
     * Maps of a game: live ones by sort_order, or the trash (most recently deleted first).
     *
     * @return list<Map>
     */
    public function listForGame(int $gameId, bool $trash): array
    {
        $sql = 'SELECT * FROM ' . $this->db->t('maps') . ' WHERE `game_id` = ? AND `deleted_at` IS '
            . ($trash ? 'NOT NULL ORDER BY `deleted_at` DESC, `id` DESC' : 'NULL ORDER BY `sort_order`, `id`')
            . ' LIMIT ' . self::LIST_LIMIT;

        return array_map(static fn (array $r): Map => Map::fromRow($r), $this->db->fetchAll($sql, [$gameId]));
    }

    public function nextSortOrder(int $gameId): int
    {
        $max = $this->db->fetchValue(
            'SELECT MAX(`sort_order`) FROM ' . $this->db->t('maps') . ' WHERE `game_id` = ? AND `deleted_at` IS NULL',
            [$gameId],
        );

        return $max === null ? 0 : min(MapInput::SORT_MAX, (int) $max + 1);
    }

    /**
     * @param array{game_id: int, owner_user_id: int, name: string, folder: ?string, sort_order: int, kind: string,
     *     cell_px: int, width: int, height: int, unit_label: string, unit_per_cell: int|float, theme: string,
     *     ambient: array<string, mixed>, palette: list<mixed>, layers: list<array<string, mixed>>} $v
     */
    public function insert(array $v): int
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('maps') . ' (`game_id`, `owner_user_id`, `name`, `folder`, `sort_order`, `kind`, '
            . "`grid_type`, `cell_px`, `width_cells`, `height_cells`, `unit_label`, `unit_per_cell`, `theme`, `ambient`, "
            . '`palette`, `layers`, `format_version`, `revision`, `created_at`, `updated_at`) '
            . "VALUES (?, ?, ?, ?, ?, ?, 'square', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            [
                $v['game_id'], $v['owner_user_id'], $v['name'], $v['folder'], $v['sort_order'], $v['kind'],
                $v['cell_px'], $v['width'], $v['height'], $v['unit_label'], (string) $v['unit_per_cell'], $v['theme'],
                json_encode($v['ambient'], self::JSON_FLAGS),
                json_encode($v['palette'], self::JSON_FLAGS),
                json_encode($v['layers'], self::JSON_FLAGS),
                Map::FORMAT_VERSION, $now, $now,
            ],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $fields among UPDATABLE (JSON columns as PHP values)
     * @param bool                 $bumpRevision revision + 1 (lot of ops)
     */
    public function update(int $id, array $fields, bool $bumpRevision = false): void
    {
        $sets = [];
        $params = [];
        foreach ($fields as $column => $value) {
            if (!in_array($column, self::UPDATABLE, true)) {
                throw new \InvalidArgumentException('Column not updatable: ' . $column);
            }
            if (in_array($column, self::JSON_COLUMNS, true)) {
                $value = json_encode($value, self::JSON_FLAGS);
            } elseif ($column === 'unit_per_cell') {
                $value = (string) $value;
            }
            $sets[] = '`' . $column . '` = ?';
            $params[] = $value;
        }
        if ($bumpRevision) {
            $sets[] = '`revision` = `revision` + 1';
        }
        $sets[] = '`updated_at` = ?';
        $params[] = $this->clock->sql();
        $params[] = $id;
        $this->db->execute('UPDATE ' . $this->db->t('maps') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
    }

    /**
     * Soft delete (trash, purged after trash_days); false when already in the trash.
     */
    public function softDelete(int $id): bool
    {
        $now = $this->clock->sql();

        return $this->db->execute(
            'UPDATE ' . $this->db->t('maps') . ' SET `deleted_at` = ?, `updated_at` = ? WHERE `id` = ? AND `deleted_at` IS NULL',
            [$now, $now, $id],
        ) === 1;
    }

    public function restore(int $id, int $sortOrder): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('maps') . ' SET `deleted_at` = NULL, `sort_order` = ?, `updated_at` = ? WHERE `id` = ?',
            [$sortOrder, $this->clock->sql(), $id],
        );
    }

    /**
     * Ids of the maps in the trash for longer than the delay.
     *
     * @return list<int>
     */
    public function expiredTrash(string $before, int $limit): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('maps') . ' WHERE `deleted_at` IS NOT NULL AND `deleted_at` < ? ORDER BY `id` LIMIT ?',
            [$before, $limit],
        );

        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }

    /**
     * Permanent deletion: floors, chunks, objects, refs, versions... follow by FK CASCADE
     * (games.world_map_id is SET NULL by its FK).
     */
    public function hardDelete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Account deletion: maps created by $userId in games now run by someone else go to that GM.
     */
    public function reassignToGameGm(int $userId): int
    {
        return $this->db->execute(
            'UPDATE ' . $this->db->t('maps') . ' m INNER JOIN ' . $this->db->t('games') . ' g ON g.`id` = m.`game_id` '
            . 'SET m.`owner_user_id` = g.`gm_user_id` WHERE m.`owner_user_id` = ? AND g.`gm_user_id` <> ?',
            [$userId, $userId],
        );
    }

    /**
     * @return list<array{id: int, game_id: ?int, name: string, created_at: string}>
     */
    public function ownedBy(int $userId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id`, `game_id`, `name`, `created_at` FROM ' . $this->db->t('maps') . ' WHERE `owner_user_id` = ? ORDER BY `id`',
            [$userId],
        );

        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'game_id' => $r['game_id'] === null ? null : (int) $r['game_id'],
            'name' => (string) $r['name'],
            'created_at' => (string) $r['created_at'],
        ], $rows);
    }

    // ---- Floors ----------------------------------------------------------------------------

    public function insertFloor(int $mapId, int $level, string $name, int $sortOrder): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_floors') . ' (`map_id`, `level`, `name`, `sort_order`) VALUES (?, ?, ?, ?)',
            [$mapId, $level, $name, $sortOrder],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @return list<array{id: int, level: int, name: string, sort_order: int}>
     */
    public function floors(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id`, `level`, `name`, `sort_order` FROM ' . $this->db->t('map_floors') . ' WHERE `map_id` = ? '
            . 'ORDER BY `sort_order`, `level`, `id`',
            [$mapId],
        );

        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'level' => (int) $r['level'],
            'name' => (string) $r['name'],
            'sort_order' => (int) $r['sort_order'],
        ], $rows);
    }

    // ---- Chunks ----------------------------------------------------------------------------

    /**
     * Locks and returns the existing chunks among $keys of one floor/layer.
     *
     * @param list<array{0: int, 1: int}> $keys [cx, cy]
     * @return array<string, string> "cx:cy" => compressed data
     */
    public function chunksForUpdate(int $mapId, int $floorId, string $layer, array $keys): array
    {
        $out = [];
        foreach (array_chunk($keys, 200) as $batch) {
            $where = implode(' OR ', array_fill(0, count($batch), '(`cx` = ? AND `cy` = ?)'));
            $params = [$mapId, $floorId, $layer];
            foreach ($batch as [$cx, $cy]) {
                $params[] = $cx;
                $params[] = $cy;
            }
            $rows = $this->db->fetchAll(
                'SELECT `cx`, `cy`, `data` FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? AND `floor_id` = ? '
                . 'AND `layer` = ? AND (' . $where . ') FOR UPDATE',
                $params,
            );
            foreach ($rows as $r) {
                $out[(int) $r['cx'] . ':' . (int) $r['cy']] = (string) $r['data'];
            }
        }

        return $out;
    }

    /**
     * Locks and returns every chunk (all floors and layers) with cx >= $minCx or cy >= $minCy.
     *
     * @return list<array{floor_id: int, layer: string, cx: int, cy: int, data: string}>
     */
    public function chunksBeyondForUpdate(int $mapId, int $minCx, int $minCy): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `floor_id`, `layer`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_chunks')
            . ' WHERE `map_id` = ? AND (`cx` >= ? OR `cy` >= ?) FOR UPDATE',
            [$mapId, $minCx, $minCy],
        );

        return array_map(static fn (array $r): array => [
            'floor_id' => (int) $r['floor_id'],
            'layer' => (string) $r['layer'],
            'cx' => (int) $r['cx'],
            'cy' => (int) $r['cy'],
            'data' => (string) $r['data'],
        ], $rows);
    }

    public function insertChunk(int $mapId, int $floorId, string $layer, int $cx, int $cy, string $data, int $revision): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_chunks') . ' (`map_id`, `floor_id`, `layer`, `cx`, `cy`, `data`, `revision`, `updated_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$mapId, $floorId, $layer, $cx, $cy, $data, $revision, $this->clock->sql()],
        );
    }

    public function updateChunk(int $mapId, int $floorId, string $layer, int $cx, int $cy, string $data, int $revision): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_chunks') . ' SET `data` = ?, `revision` = ?, `updated_at` = ? '
            . 'WHERE `map_id` = ? AND `floor_id` = ? AND `layer` = ? AND `cx` = ? AND `cy` = ?',
            [$data, $revision, $this->clock->sql(), $mapId, $floorId, $layer, $cx, $cy],
        );
    }

    public function deleteChunk(int $mapId, int $floorId, string $layer, int $cx, int $cy): void
    {
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? AND `floor_id` = ? AND `layer` = ? AND `cx` = ? AND `cy` = ?',
            [$mapId, $floorId, $layer, $cx, $cy],
        );
    }

    /**
     * Chunks of one floor for the binary endpoint, ordered by layer, cy, cx.
     *
     * @param list<string>                     $layers
     * @param list<array{0: int, 1: int}>|null $cells [cx, cy]; null = every chunk
     * @return list<array{layer: string, cx: int, cy: int, data: string}>
     */
    public function readChunks(int $mapId, int $floorId, array $layers, ?array $cells): array
    {
        if ($layers === [] || $cells === []) {
            return [];
        }
        $sql = 'SELECT `layer`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? AND `floor_id` = ? '
            . 'AND `layer` IN (' . implode(', ', array_fill(0, count($layers), '?')) . ')';
        $params = [$mapId, $floorId, ...$layers];
        if ($cells !== null) {
            $sql .= ' AND (' . implode(' OR ', array_fill(0, count($cells), '(`cx` = ? AND `cy` = ?)')) . ')';
            foreach ($cells as [$cx, $cy]) {
                $params[] = $cx;
                $params[] = $cy;
            }
        }
        $rows = $this->db->fetchAll($sql, $params);
        $out = array_map(static fn (array $r): array => [
            'layer' => (string) $r['layer'],
            'cx' => (int) $r['cx'],
            'cy' => (int) $r['cy'],
            'data' => (string) $r['data'],
        ], $rows);
        $order = array_flip(MapInput::TILE_LAYERS);
        usort($out, static fn (array $a, array $b): int => [$order[$a['layer']] ?? 9, $a['cy'], $a['cx']]
            <=> [$order[$b['layer']] ?? 9, $b['cy'], $b['cx']]);

        return $out;
    }

    /**
     * Every chunk of a map (tests, integrity).
     *
     * @return list<array{floor_id: int, layer: string, cx: int, cy: int, data: string, revision: int}>
     */
    public function allChunks(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `floor_id`, `layer`, `cx`, `cy`, `data`, `revision` FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? '
            . 'ORDER BY `floor_id`, `layer`, `cy`, `cx`',
            [$mapId],
        );

        return array_map(static fn (array $r): array => [
            'floor_id' => (int) $r['floor_id'],
            'layer' => (string) $r['layer'],
            'cx' => (int) $r['cx'],
            'cy' => (int) $r['cy'],
            'data' => (string) $r['data'],
            'revision' => (int) $r['revision'],
        ], $rows);
    }

    /**
     * Copies every chunk of a floor to another map/floor (duplication), revision 0.
     */
    public function copyChunks(int $fromMapId, int $fromFloorId, int $toMapId, int $toFloorId): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_chunks') . ' (`map_id`, `floor_id`, `layer`, `cx`, `cy`, `data`, `revision`, `updated_at`) '
            . 'SELECT ?, ?, `layer`, `cx`, `cy`, `data`, 0, ? FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? AND `floor_id` = ?',
            [$toMapId, $toFloorId, $this->clock->sql(), $fromMapId, $fromFloorId],
        );
    }

    // ---- Asset references ------------------------------------------------------------------

    /**
     * @return array<int, int> asset_id => ref_count
     */
    public function refs(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `asset_id`, `ref_count` FROM ' . $this->db->t('map_asset_refs') . ' WHERE `map_id` = ? ORDER BY `asset_id`',
            [$mapId],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['asset_id']] = (int) $r['ref_count'];
        }

        return $out;
    }

    /**
     * Applies cell count changes per asset. Increments only for assets that still exist (a
     * purged asset has no row to reference); rows falling to 0 are removed.
     *
     * @param array<int, int> $deltas asset_id => +/- cells
     */
    public function applyRefDeltas(int $mapId, array $deltas): void
    {
        $deltas = array_filter($deltas, static fn (int $d): bool => $d !== 0);
        if ($deltas === []) {
            return;
        }
        ksort($deltas);
        $t = $this->db->t('map_asset_refs');
        $existing = $this->existingAssetIds(array_keys(array_filter($deltas, static fn (int $d): bool => $d > 0)));
        foreach ($deltas as $assetId => $delta) {
            if ($delta > 0) {
                if (!isset($existing[$assetId])) {
                    continue;
                }
                $this->db->execute(
                    'INSERT INTO ' . $t . ' (`map_id`, `asset_id`, `ref_count`) VALUES (?, ?, ?) '
                    . 'ON DUPLICATE KEY UPDATE `ref_count` = `ref_count` + ?',
                    [$mapId, $assetId, $delta, $delta],
                );
            } else {
                $this->db->execute(
                    'UPDATE ' . $t . ' SET `ref_count` = IF(`ref_count` > ?, `ref_count` - ?, 0) WHERE `map_id` = ? AND `asset_id` = ?',
                    [-$delta, -$delta, $mapId, $assetId],
                );
            }
        }
        $ids = array_keys($deltas);
        $this->db->execute(
            'DELETE FROM ' . $t . ' WHERE `map_id` = ? AND `ref_count` = 0 AND `asset_id` IN ('
            . implode(', ', array_fill(0, count($ids), '?')) . ')',
            [$mapId, ...$ids],
        );
    }

    public function copyRefs(int $fromMapId, int $toMapId): void
    {
        $t = $this->db->t('map_asset_refs');
        $this->db->execute(
            'INSERT INTO ' . $t . ' (`map_id`, `asset_id`, `ref_count`) SELECT ?, `asset_id`, `ref_count` FROM ' . $t . ' WHERE `map_id` = ?',
            [$toMapId, $fromMapId],
        );
    }

    /**
     * @param list<int> $ids
     * @return array<int, true>
     */
    public function existingAssetIds(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('assets') . ' WHERE `id` IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')',
            $ids,
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['id']] = true;
        }

        return $out;
    }

    /**
     * Assets of a palette (for names and signed URLs), whatever their state.
     *
     * @param list<int> $ids
     * @return array<int, array{uuid: string, name: string, deleted: bool}>
     */
    public function paletteAssets(array $ids): array
    {
        $out = [];
        foreach (array_chunk(array_values(array_unique($ids)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id`, `uuid`, `name`, `deleted_at` FROM ' . $this->db->t('assets') . ' WHERE `id` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                $batch,
            );
            foreach ($rows as $r) {
                $out[(int) $r['id']] = ['uuid' => (string) $r['uuid'], 'name' => (string) $r['name'], 'deleted' => $r['deleted_at'] !== null];
            }
        }

        return $out;
    }

    // ---- Idempotence (processed_ops) -------------------------------------------------------

    /**
     * @return array{user_id: int, response: mixed}|null
     */
    public function processed(string $clientOpId): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT `user_id`, `response` FROM ' . $this->db->t('processed_ops') . ' WHERE `client_op_id` = ?',
            [$clientOpId],
        );
        if ($row === null) {
            return null;
        }

        return ['user_id' => (int) $row['user_id'], 'response' => json_decode((string) $row['response'], true)];
    }

    /**
     * @param array<string, mixed> $response
     */
    public function rememberProcessed(string $clientOpId, int $userId, array $response): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('processed_ops') . ' (`client_op_id`, `user_id`, `response`, `created_at`) VALUES (?, ?, ?, ?)',
            [$clientOpId, $userId, json_encode($response, self::JSON_FLAGS), $this->clock->sql()],
        );
    }

    public function purgeProcessed(string $before, int $limit): int
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('processed_ops') . ' WHERE `created_at` < ? LIMIT ' . max(1, $limit),
            [$before],
        );
    }
}
