<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Maps\ObjectRules;
use JDR\Maps\TokenRules;

/**
 * SQL access to the P5 content of maps (projet.md 7.2): map_objects, map_tokens (placed tokens)
 * and map_fog. JSON columns (geometry, props, light_override) are opaque for SQL: encoded and
 * validated by PHP, key order rebuilt after a read (ObjectRules::canonical). Objects and tokens
 * are returned in their API form (floor as a string id; token_id as an int, serialized as a
 * string by the API envelope).
 */
final class MapSceneRepository
{
    private const OBJECT_COLUMNS = '`id`, `uid`, `floor_id`, `type`, `layer`, `geometry`, `props`, `visibility`, `locked`, `sort_order`, `rev`';
    private const TOKEN_COLUMNS = '`id`, `uid`, `floor_id`, `token_id`, `x`, `y`, `rotation`, `scale`, `hidden`, `light_override`, `rev`';

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    // ---- Objects ---------------------------------------------------------------------------

    /**
     * Objects of a map (all floors, or one), sorted by floor, sort_order, id; $bbox keeps those
     * whose bounding box intersects [x1, y1, x2, y2].
     *
     * @param array{0: float, 1: float, 2: float, 3: float}|null $bbox
     * @return list<array<string, mixed>>
     */
    public function objects(int $mapId, ?int $floorId = null, ?array $bbox = null): array
    {
        $sql = 'SELECT ' . self::OBJECT_COLUMNS . ' FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ?';
        $params = [$mapId];
        if ($floorId !== null) {
            $sql .= ' AND `floor_id` = ?';
            $params[] = $floorId;
        }
        if ($bbox !== null) {
            $sql .= ' AND `bbox_x1` <= ? AND `bbox_x2` >= ? AND `bbox_y1` <= ? AND `bbox_y2` >= ?';
            array_push($params, self::dec($bbox[2]), self::dec($bbox[0]), self::dec($bbox[3]), self::dec($bbox[1]));
        }
        $rows = $this->db->fetchAll($sql . ' ORDER BY `floor_id`, `sort_order`, `id`', $params);

        return array_map(self::objectFromRow(...), $rows);
    }

    /**
     * @param list<string> $uids
     * @return list<array{id: int, object: array<string, mixed>}>
     */
    public function objectsByUid(int $mapId, array $uids): array
    {
        $out = [];
        foreach (array_chunk(array_values(array_unique($uids)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT ' . self::OBJECT_COLUMNS . ' FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `uid` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                [$mapId, ...$batch],
            );
            foreach ($rows as $r) {
                $out[] = ['id' => (int) $r['id'], 'object' => self::objectFromRow($r)];
            }
        }

        return $out;
    }

    /**
     * @return list<array{id: int, object: array<string, mixed>}>
     */
    public function objectRows(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT ' . self::OBJECT_COLUMNS . ' FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? ORDER BY `id`',
            [$mapId],
        );

        return array_map(static fn (array $r): array => ['id' => (int) $r['id'], 'object' => self::objectFromRow($r)], $rows);
    }

    public function countObjects(int $mapId): int
    {
        return (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ?', [$mapId]);
    }

    /**
     * @param array<string, mixed>                          $object API form (floor id as string or int)
     * @param array{0: float, 1: float, 2: float, 3: float} $bbox
     */
    public function insertObject(int $mapId, array $object, array $bbox): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_objects') . ' (`uid`, `map_id`, `floor_id`, `layer`, `type`, `geometry`, `props`, '
            . '`visibility`, `locked`, `sort_order`, `bbox_x1`, `bbox_y1`, `bbox_x2`, `bbox_y2`, `rev`, `updated_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $object['uid'], $mapId, (int) $object['floor'], $object['layer'], $object['type'],
                json_encode($object['geometry'], MapRepository::JSON_FLAGS),
                json_encode($object['props'], MapRepository::JSON_FLAGS),
                $object['visibility'], $object['locked'] ? 1 : 0, $object['sort_order'],
                self::dec($bbox[0]), self::dec($bbox[1]), self::dec($bbox[2]), self::dec($bbox[3]),
                (int) ($object['rev'] ?? 1), $this->clock->sql(),
            ],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed>                          $object API form
     * @param array{0: float, 1: float, 2: float, 3: float} $bbox
     */
    public function updateObject(int $id, array $object, array $bbox): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_objects') . ' SET `layer` = ?, `geometry` = ?, `props` = ?, `visibility` = ?, `locked` = ?, '
            . '`sort_order` = ?, `bbox_x1` = ?, `bbox_y1` = ?, `bbox_x2` = ?, `bbox_y2` = ?, `rev` = ?, `updated_at` = ? WHERE `id` = ?',
            [
                $object['layer'],
                json_encode($object['geometry'], MapRepository::JSON_FLAGS),
                json_encode($object['props'], MapRepository::JSON_FLAGS),
                $object['visibility'], $object['locked'] ? 1 : 0, $object['sort_order'],
                self::dec($bbox[0]), self::dec($bbox[1]), self::dec($bbox[2]), self::dec($bbox[3]),
                (int) $object['rev'], $this->clock->sql(), $id,
            ],
        );
    }

    public function deleteObject(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('map_objects') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Bounding boxes of the objects of a map (tests, integrity): uid => [x1, y1, x2, y2].
     *
     * @return array<string, array{0: float, 1: float, 2: float, 3: float}>
     */
    public function bboxes(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `uid`, `bbox_x1`, `bbox_y1`, `bbox_x2`, `bbox_y2` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ?',
            [$mapId],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['uid']] = [(float) $r['bbox_x1'], (float) $r['bbox_y1'], (float) $r['bbox_x2'], (float) $r['bbox_y2']];
        }

        return $out;
    }

    /**
     * uids of the objects revealed to the players (revealed_at set; PlayerFilter, P6).
     *
     * @return list<string>
     */
    public function revealedUids(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `uid` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `revealed_at` IS NOT NULL',
            [$mapId],
        );

        return array_map(static fn (array $r): string => (string) $r['uid'], $rows);
    }

    // ---- Placed tokens ---------------------------------------------------------------------

    /**
     * Placed tokens of a map, sorted by floor, id.
     *
     * @return list<array<string, mixed>>
     */
    public function tokens(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT ' . self::TOKEN_COLUMNS . ' FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? ORDER BY `floor_id`, `id`',
            [$mapId],
        );

        return array_map(self::tokenFromRow(...), $rows);
    }

    /**
     * Placed tokens with the name of their definition (map document).
     *
     * @return list<array{token: array<string, mixed>, name: string}>
     */
    public function tokensWithNames(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT mt.`id`, mt.`uid`, mt.`floor_id`, mt.`token_id`, mt.`x`, mt.`y`, mt.`rotation`, mt.`scale`, mt.`hidden`, '
            . 'mt.`light_override`, mt.`rev`, t.`name` AS `token_name` FROM ' . $this->db->t('map_tokens') . ' mt INNER JOIN '
            . $this->db->t('tokens') . ' t ON t.`id` = mt.`token_id` WHERE mt.`map_id` = ? ORDER BY mt.`floor_id`, mt.`id`',
            [$mapId],
        );

        return array_map(static fn (array $r): array => ['token' => self::tokenFromRow($r), 'name' => (string) $r['token_name']], $rows);
    }

    /**
     * @param list<string> $uids
     * @return list<array{id: int, token: array<string, mixed>}>
     */
    public function tokensByUid(int $mapId, array $uids): array
    {
        $out = [];
        foreach (array_chunk(array_values(array_unique($uids)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT ' . self::TOKEN_COLUMNS . ' FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? AND `uid` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                [$mapId, ...$batch],
            );
            foreach ($rows as $r) {
                $out[] = ['id' => (int) $r['id'], 'token' => self::tokenFromRow($r)];
            }
        }

        return $out;
    }

    /**
     * @return list<array{id: int, token: array<string, mixed>}>
     */
    public function tokenRows(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT ' . self::TOKEN_COLUMNS . ' FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? ORDER BY `id`',
            [$mapId],
        );

        return array_map(static fn (array $r): array => ['id' => (int) $r['id'], 'token' => self::tokenFromRow($r)], $rows);
    }

    public function countTokens(int $mapId): int
    {
        return (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ?', [$mapId]);
    }

    /**
     * @param array<string, mixed> $token API form
     */
    public function insertToken(int $mapId, array $token): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_tokens') . ' (`uid`, `map_id`, `floor_id`, `token_id`, `x`, `y`, `rotation`, `scale`, '
            . '`hidden`, `light_override`, `rev`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $token['uid'], $mapId, (int) $token['floor'], (int) $token['token_id'],
                self::dec($token['x']), self::dec($token['y']), $token['rotation'], self::dec($token['scale'], 2),
                $token['hidden'] ? 1 : 0,
                $token['light_override'] === null ? null : json_encode($token['light_override'], MapRepository::JSON_FLAGS),
                (int) ($token['rev'] ?? 1), $this->clock->sql(),
            ],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $token API form
     */
    public function updateToken(int $id, array $token): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_tokens') . ' SET `x` = ?, `y` = ?, `rotation` = ?, `scale` = ?, `hidden` = ?, '
            . '`light_override` = ?, `rev` = ?, `updated_at` = ? WHERE `id` = ?',
            [
                self::dec($token['x']), self::dec($token['y']), $token['rotation'], self::dec($token['scale'], 2),
                $token['hidden'] ? 1 : 0,
                $token['light_override'] === null ? null : json_encode($token['light_override'], MapRepository::JSON_FLAGS),
                (int) $token['rev'], $this->clock->sql(), $id,
            ],
        );
    }

    public function deleteToken(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('map_tokens') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Live token definition of a game.
     */
    public function isLiveGameToken(int $gameId, int $tokenId): bool
    {
        return $this->db->fetchValue(
            'SELECT 1 FROM ' . $this->db->t('tokens') . ' WHERE `id` = ? AND `game_id` = ? AND `deleted_at` IS NULL',
            [$tokenId, $gameId],
        ) !== null;
    }

    /**
     * Live tokens of a game by name (first by id for a name used twice) and the live ids among
     * $ids (map document import / restore).
     *
     * @param list<string> $names
     * @param list<int>    $ids
     * @return array{names: array<string, int>, ids: array<int, true>}
     */
    public function gameTokens(int $gameId, array $names, array $ids): array
    {
        $out = ['names' => [], 'ids' => []];
        foreach (array_chunk(array_values(array_unique($names)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id`, `name` FROM ' . $this->db->t('tokens') . ' WHERE `game_id` = ? AND `deleted_at` IS NULL AND `name` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ') ORDER BY `id`',
                [$gameId, ...$batch],
            );
            foreach ($rows as $r) {
                // The name column is case-insensitive: keep exact matches only.
                $name = (string) $r['name'];
                if (in_array($name, $batch, true)) {
                    $out['names'][$name] ??= (int) $r['id'];
                }
            }
        }
        foreach (array_chunk(array_values(array_unique($ids)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id` FROM ' . $this->db->t('tokens') . ' WHERE `game_id` = ? AND `deleted_at` IS NULL AND `id` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                [$gameId, ...$batch],
            );
            foreach ($rows as $r) {
                $out['ids'][(int) $r['id']] = true;
            }
        }

        return $out;
    }

    // ---- Fog -------------------------------------------------------------------------------

    /**
     * Fog chunks of a floor ordered by cy, cx (compressed data).
     *
     * @return list<array{cx: int, cy: int, data: string}>
     */
    public function fog(int $mapId, int $floorId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `cx`, `cy`, `data` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ? ORDER BY `cy`, `cx`',
            [$mapId, $floorId],
        );

        return array_map(static fn (array $r): array => ['cx' => (int) $r['cx'], 'cy' => (int) $r['cy'], 'data' => (string) $r['data']], $rows);
    }

    /**
     * Every fog chunk of a map.
     *
     * @return list<array{floor_id: int, cx: int, cy: int, data: string}>
     */
    public function allFog(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `floor_id`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? ORDER BY `floor_id`, `cy`, `cx`',
            [$mapId],
        );

        return array_map(static fn (array $r): array => [
            'floor_id' => (int) $r['floor_id'],
            'cx' => (int) $r['cx'],
            'cy' => (int) $r['cy'],
            'data' => (string) $r['data'],
        ], $rows);
    }

    /**
     * @param list<array{0: int, 1: int}> $keys
     * @return array<string, string> "cx:cy" => compressed data
     */
    public function fogForUpdate(int $mapId, int $floorId, array $keys): array
    {
        $out = [];
        foreach (array_chunk($keys, 200) as $batch) {
            $where = implode(' OR ', array_fill(0, count($batch), '(`cx` = ? AND `cy` = ?)'));
            $params = [$mapId, $floorId];
            foreach ($batch as [$cx, $cy]) {
                $params[] = $cx;
                $params[] = $cy;
            }
            $rows = $this->db->fetchAll(
                'SELECT `cx`, `cy`, `data` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ? AND (' . $where . ') FOR UPDATE',
                $params,
            );
            foreach ($rows as $r) {
                $out[(int) $r['cx'] . ':' . (int) $r['cy']] = (string) $r['data'];
            }
        }

        return $out;
    }

    public function insertFog(int $mapId, int $floorId, int $cx, int $cy, string $data): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_fog') . ' (`map_id`, `floor_id`, `cx`, `cy`, `data`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?)',
            [$mapId, $floorId, $cx, $cy, $data, $this->clock->sql()],
        );
    }

    public function updateFog(int $mapId, int $floorId, int $cx, int $cy, string $data): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_fog') . ' SET `data` = ?, `updated_at` = ? WHERE `map_id` = ? AND `floor_id` = ? AND `cx` = ? AND `cy` = ?',
            [$data, $this->clock->sql(), $mapId, $floorId, $cx, $cy],
        );
    }

    public function deleteFog(int $mapId, int $floorId, int $cx, int $cy): void
    {
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ? AND `cx` = ? AND `cy` = ?',
            [$mapId, $floorId, $cx, $cy],
        );
    }

    public function clearFog(int $mapId, int $floorId): int
    {
        return $this->db->execute('DELETE FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ?', [$mapId, $floorId]);
    }

    public function deleteFogBeyond(int $mapId, int $minCx, int $minCy): void
    {
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND (`cx` >= ? OR `cy` >= ?)',
            [$mapId, $minCx, $minCy],
        );
    }

    // ---- Whole map -------------------------------------------------------------------------

    /**
     * Copies the objects, placed tokens and fog of a floor to another map / floor (map
     * duplication); objects and tokens start again at rev 1.
     */
    public function copyFloor(int $fromMapId, int $fromFloorId, int $toMapId, int $toFloorId): void
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_objects') . ' (`uid`, `map_id`, `floor_id`, `layer`, `type`, `asset_id`, `geometry`, `props`, '
            . '`visibility`, `revealed_at`, `locked`, `sort_order`, `bbox_x1`, `bbox_y1`, `bbox_x2`, `bbox_y2`, `rev`, `updated_at`) '
            . 'SELECT `uid`, ?, ?, `layer`, `type`, `asset_id`, `geometry`, `props`, `visibility`, `revealed_at`, `locked`, `sort_order`, '
            . '`bbox_x1`, `bbox_y1`, `bbox_x2`, `bbox_y2`, 1, ? FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `floor_id` = ? ORDER BY `id`',
            [$toMapId, $toFloorId, $now, $fromMapId, $fromFloorId],
        );
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_tokens') . ' (`uid`, `map_id`, `floor_id`, `token_id`, `x`, `y`, `rotation`, `scale`, `hidden`, '
            . '`light_override`, `rev`, `updated_at`) SELECT `uid`, ?, ?, `token_id`, `x`, `y`, `rotation`, `scale`, `hidden`, `light_override`, 1, ? '
            . 'FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? AND `floor_id` = ? ORDER BY `id`',
            [$toMapId, $toFloorId, $now, $fromMapId, $fromFloorId],
        );
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_fog') . ' (`map_id`, `floor_id`, `cx`, `cy`, `data`, `updated_at`) '
            . 'SELECT ?, ?, `cx`, `cy`, `data`, ? FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ?',
            [$toMapId, $toFloorId, $now, $fromMapId, $fromFloorId],
        );
    }

    /**
     * Deletes every object, placed token and fog chunk of a map (version restore).
     */
    public function clear(int $mapId): void
    {
        foreach (['map_objects', 'map_tokens', 'map_fog'] as $table) {
            $this->db->execute('DELETE FROM ' . $this->db->t($table) . ' WHERE `map_id` = ?', [$mapId]);
        }
    }

    // ---- Rows ------------------------------------------------------------------------------

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    public static function objectFromRow(array $r): array
    {
        $geometry = json_decode((string) $r['geometry'], true);
        $props = json_decode((string) $r['props'], true);

        return ObjectRules::canonical([
            'uid' => (string) $r['uid'],
            'floor' => (string) (int) $r['floor_id'],
            'type' => (string) $r['type'],
            'layer' => (string) $r['layer'],
            'geometry' => is_array($geometry) ? $geometry : [],
            'props' => is_array($props) ? $props : [],
            'visibility' => (string) $r['visibility'],
            'locked' => (int) $r['locked'] === 1,
            'sort_order' => (int) $r['sort_order'],
            'rev' => (int) $r['rev'],
        ]);
    }

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    public static function tokenFromRow(array $r): array
    {
        $light = $r['light_override'] === null ? null : json_decode((string) $r['light_override'], true);

        return [
            'uid' => (string) $r['uid'],
            'floor' => (string) (int) $r['floor_id'],
            'token_id' => (int) $r['token_id'],
            'x' => self::num($r['x']),
            'y' => self::num($r['y']),
            'rotation' => (int) $r['rotation'],
            'scale' => self::num($r['scale']),
            'hidden' => (int) $r['hidden'] === 1,
            'light_override' => TokenRules::canonicalLight($light),
            'rev' => (int) $r['rev'],
        ];
    }

    /**
     * DECIMAL text => int when integral, else float (same convention as Fields::number).
     */
    public static function num(mixed $value): int|float
    {
        $f = round((float) $value, 3);

        return floor($f) === $f && abs($f) < 1.0E9 ? (int) $f : $f;
    }

    /**
     * Number => DECIMAL parameter text (never in exponent notation).
     */
    private static function dec(int|float $value, int $decimals = 3): string
    {
        return number_format((float) $value, $decimals, '.', '');
    }
}
