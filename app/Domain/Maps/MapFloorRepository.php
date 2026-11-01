<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * SQL of the floor ops (floor.update / floor.remove, P9a1); reads and inserts stay in MapRepository.
 */
final class MapFloorRepository
{
    public function __construct(private Db $db)
    {
    }

    /**
     * @param array{level?: int, name?: string, sort_order?: int} $fields
     */
    public function update(int $floorId, array $fields): void
    {
        $sets = [];
        $params = [];
        foreach (['level', 'name', 'sort_order'] as $column) {
            if (array_key_exists($column, $fields)) {
                $sets[] = '`' . $column . '` = ?';
                $params[] = $fields[$column];
            }
        }
        if ($sets !== []) {
            $params[] = $floorId;
            $this->db->execute('UPDATE ' . $this->db->t('map_floors') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
        }
    }

    /**
     * Deletes the floor; chunks, objects, placed tokens and fog go with it (FK CASCADE), links
     * pointing to it keep a NULL floor (FK SET NULL).
     */
    public function delete(int $floorId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('map_floors') . ' WHERE `id` = ?', [$floorId]);
    }

    /**
     * Locks and returns every chunk of one floor (all layers).
     *
     * @return list<array{layer: string, cx: int, cy: int, data: string}>
     */
    public function chunksForUpdate(int $mapId, int $floorId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `layer`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? AND `floor_id` = ? FOR UPDATE',
            [$mapId, $floorId],
        );

        return array_map(static fn (array $r): array => [
            'layer' => (string) $r['layer'],
            'cx' => (int) $r['cx'],
            'cy' => (int) $r['cy'],
            'data' => (string) $r['data'],
        ], $rows);
    }

    /**
     * Sessions of the map that stand on $floorId move to $toFloorId.
     * Must run BEFORE the delete (FK SET NULL on play_sessions.current_floor_id).
     *
     * @return list<int> ids of the sessions moved (open or not)
     */
    public function moveSessions(int $mapId, int $floorId, int $toFloorId): array
    {
        $ids = array_map('intval', array_column($this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('play_sessions') . ' WHERE `current_map_id` = ? AND `current_floor_id` = ? '
            . "AND `state` <> 'ended' FOR UPDATE",
            [$mapId, $floorId],
        ), 'id'));
        if ($ids !== []) {
            $this->db->execute(
                'UPDATE ' . $this->db->t('play_sessions') . ' SET `current_floor_id` = ? WHERE `current_map_id` = ? AND `current_floor_id` = ?',
                [$toFloorId, $mapId, $floorId],
            );
        }

        return $ids;
    }

    /**
     * Gives every floor of the map a distinct out-of-range level (-10000 - n), to free the levels
     * before a rewrite (UNIQUE map_id + level).
     */
    public function parkLevels(int $mapId): void
    {
        $ids = $this->db->fetchAll('SELECT `id` FROM ' . $this->db->t('map_floors') . ' WHERE `map_id` = ? ORDER BY `id`', [$mapId]);
        foreach ($ids as $n => $row) {
            $this->update((int) $row['id'], ['level' => -10000 - $n]);
        }
    }
}
