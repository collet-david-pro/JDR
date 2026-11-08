<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * Links between maps (P9a1): the table map_links mirrors props.link of the objects (door, stairs,
 * portal) of a map, to query "which maps point to this one" and to clean up. props.link stays the
 * source of truth (a link survives the permanent deletion of its target, shown "broken").
 * - sync(): one object, after an insert / update; rebuildMap(): a whole map (import, version
 *   restore, duplication);
 * - report(): GET /maps/{id}/links; annotate(): marks props.link.broken on the objects whose target
 *   map is in the trash.
 */
final class MapLinks
{
    public const OBJECT_TYPES = ['door', 'stairs', 'portal'];

    public function __construct(private Db $db)
    {
    }

    /**
     * Floor uids of $mapId when it is a live map of the game (a valid link target), else null.
     *
     * @return list<string>|null
     */
    public function targetFloors(int $gameId, int $mapId): ?array
    {
        $found = $this->db->fetchValue(
            'SELECT `id` FROM ' . $this->db->t('maps') . ' WHERE `id` = ? AND `game_id` = ? AND `deleted_at` IS NULL',
            [$mapId, $gameId],
        );
        if ($found === null) {
            return null;
        }
        $rows = $this->db->fetchAll('SELECT `uid` FROM ' . $this->db->t('map_floors') . ' WHERE `map_id` = ? ORDER BY `sort_order`, `id`', [$mapId]);

        return array_map(static fn (array $r): string => (string) $r['uid'], $rows);
    }

    /**
     * Rewrites the row of one object from its props.link (none = row deleted).
     *
     * @param array<string, mixed>|null $link
     */
    public function sync(int $mapId, int $objectId, ?array $link): void
    {
        $t = $this->db->t('map_links');
        $this->db->execute('DELETE FROM ' . $t . ' WHERE `from_object_id` = ?', [$objectId]);
        $target = $link['map_id'] ?? null;
        if (!is_int($target)
            || $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$target]) === null) {
            return;
        }
        $floorId = null;
        if (is_string($link['floor'] ?? null)) {
            $found = $this->db->fetchValue(
                'SELECT `id` FROM ' . $this->db->t('map_floors') . ' WHERE `map_id` = ? AND `uid` = ?',
                [$target, $link['floor']],
            );
            $floorId = $found === null ? null : (int) $found;
        }
        $this->db->execute(
            'INSERT INTO ' . $t . ' (`from_map_id`, `from_object_id`, `to_map_id`, `to_floor_id`, `to_x`, `to_y`) VALUES (?, ?, ?, ?, ?, ?)',
            [$mapId, $objectId, $target, $floorId, $link['x'] ?? null, $link['y'] ?? null],
        );
    }

    /**
     * Rebuilds every row of a map from the props of its objects.
     */
    public function rebuildMap(int $mapId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('map_links') . ' WHERE `from_map_id` = ?', [$mapId]);
        $rows = $this->db->fetchAll(
            'SELECT `id`, `props` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `type` IN (\'door\', \'stairs\', \'portal\')',
            [$mapId],
        );
        foreach ($rows as $row) {
            $props = json_decode((string) $row['props'], true);
            $link = is_array($props) && is_array($props['link'] ?? null) ? $props['link'] : null;
            if ($link !== null) {
                $this->sync($mapId, (int) $row['id'], $link);
            }
        }
    }

    /**
     * GET /maps/{id}/links.
     *
     * @return array{outgoing: list<array<string, mixed>>, incoming: list<array<string, mixed>>}
     */
    public function report(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT o.`uid` AS object_uid, fo.`uid` AS floor_uid, l.`to_map_id`, tm.`name` AS map_name, tm.`deleted_at` AS map_deleted, '
            . 'tf.`uid` AS to_floor_uid, tf.`name` AS to_floor_name, l.`to_x`, l.`to_y`, o.`props` '
            . 'FROM ' . $this->db->t('map_links') . ' l '
            . 'JOIN ' . $this->db->t('map_objects') . ' o ON o.`id` = l.`from_object_id` '
            . 'JOIN ' . $this->db->t('map_floors') . ' fo ON fo.`id` = o.`floor_id` '
            . 'JOIN ' . $this->db->t('maps') . ' tm ON tm.`id` = l.`to_map_id` '
            . 'LEFT JOIN ' . $this->db->t('map_floors') . ' tf ON tf.`id` = l.`to_floor_id` '
            . 'WHERE l.`from_map_id` = ? ORDER BY o.`floor_id`, o.`sort_order`, o.`id`',
            [$mapId],
        );
        $outgoing = [];
        foreach ($rows as $r) {
            $props = json_decode((string) $r['props'], true);
            $wanted = is_array($props) && is_array($props['link'] ?? null) ? ($props['link']['floor'] ?? null) : null;
            $outgoing[] = [
                'object_uid' => (string) $r['object_uid'],
                'floor' => (string) $r['floor_uid'],
                'to' => [
                    'map_id' => (int) $r['to_map_id'],
                    'map_name' => (string) $r['map_name'],
                    'floor' => $r['to_floor_uid'] === null ? null : (string) $r['to_floor_uid'],
                    'floor_name' => $r['to_floor_name'] === null ? null : (string) $r['to_floor_name'],
                    'x' => $r['to_x'] === null ? null : MapSceneRepository::num($r['to_x']),
                    'y' => $r['to_y'] === null ? null : MapSceneRepository::num($r['to_y']),
                ],
                // Target in the trash, or a target floor that no longer exists.
                'broken' => $r['map_deleted'] !== null || ($wanted !== null && $r['to_floor_uid'] === null),
            ];
        }
        $rows = $this->db->fetchAll(
            'SELECT l.`from_map_id`, m.`name`, o.`uid` FROM ' . $this->db->t('map_links') . ' l '
            . 'JOIN ' . $this->db->t('maps') . ' m ON m.`id` = l.`from_map_id` '
            . 'JOIN ' . $this->db->t('map_objects') . ' o ON o.`id` = l.`from_object_id` '
            . 'WHERE l.`to_map_id` = ? AND l.`from_map_id` <> ? AND m.`deleted_at` IS NULL ORDER BY m.`sort_order`, m.`id`, o.`id`',
            [$mapId, $mapId],
        );
        $incoming = array_map(static fn (array $r): array => [
            'map_id' => (int) $r['from_map_id'],
            'map_name' => (string) $r['name'],
            'object_uid' => (string) $r['uid'],
        ], $rows);

        return ['outgoing' => $outgoing, 'incoming' => $incoming];
    }

    /**
     * The map was resized with an anchor: the arrival points of the links of other maps that lead
     * to it follow the content (moved by dx, dy cells); one that now lies outside the map loses
     * its point (the party arrives at the default place).
     */
    public function shiftArrivals(int $mapId, int $dx, int $dy, int $width, int $height): void
    {
        $t = $this->db->t('map_links');
        $rows = $this->db->fetchAll(
            'SELECT l.`id`, l.`from_object_id`, o.`props` FROM ' . $t . ' l JOIN ' . $this->db->t('map_objects') . ' o ON o.`id` = l.`from_object_id` '
            . 'WHERE l.`to_map_id` = ? AND l.`from_map_id` <> ? AND (l.`to_x` IS NOT NULL OR l.`to_y` IS NOT NULL)',
            [$mapId, $mapId],
        );
        foreach ($rows as $row) {
            $props = json_decode((string) $row['props'], true);
            $link = is_array($props) && is_array($props['link'] ?? null) ? $props['link'] : null;
            if ($link === null || ($link['map_id'] ?? null) !== $mapId || !isset($link['x'], $link['y'])) {
                continue;
            }
            $x = round($link['x'] + $dx, 3);
            $y = round($link['y'] + $dy, 3);
            $inside = $x >= 0 && $y >= 0 && $x <= $width && $y <= $height;
            $props['link']['x'] = $inside ? $x : null;
            $props['link']['y'] = $inside ? $y : null;
            $this->db->execute(
                'UPDATE ' . $this->db->t('map_objects') . ' SET `props` = ? WHERE `id` = ?',
                [json_encode($props, MapRepository::JSON_FLAGS), (int) $row['from_object_id']],
            );
            $this->db->execute('UPDATE ' . $t . ' SET `to_x` = ?, `to_y` = ? WHERE `id` = ?', [$inside ? $x : null, $inside ? $y : null, (int) $row['id']]);
        }
    }

    /**
     * Objects (API form) with props.link.broken = true when the target map is in the trash.
     *
     * @param list<array<string, mixed>> $objects
     * @return list<array<string, mixed>>
     */
    public static function annotate(Db $db, array $objects): array
    {
        $ids = [];
        foreach ($objects as $o) {
            $target = $o['props']['link']['map_id'] ?? null;
            if (is_int($target)) {
                $ids[$target] = $target;
            }
        }
        if ($ids === []) {
            return $objects;
        }
        $rows = $db->fetchAll(
            'SELECT `id` FROM ' . $db->t('maps') . ' WHERE `deleted_at` IS NOT NULL AND `id` IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')',
            array_values($ids),
        );
        $trashed = array_fill_keys(array_map(static fn (array $r): int => (int) $r['id'], $rows), true);
        foreach ($objects as $i => $o) {
            $target = $o['props']['link']['map_id'] ?? null;
            if (is_int($target) && isset($trashed[$target])) {
                $objects[$i]['props']['link']['broken'] = true;
            }
        }

        return $objects;
    }
}
