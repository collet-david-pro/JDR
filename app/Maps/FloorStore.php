<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Writes of the floor ops (FloorApplier) on one locked map.
 */
interface FloorStore
{
    /**
     * Inserts a floor and returns its id.
     */
    public function insert(string $uid, int $level, string $name, int $sortOrder): int;

    /**
     * @param array{level?: int, name?: string, sort_order?: int} $fields
     */
    public function update(int $floorId, array $fields): void;

    /**
     * Sessions of the map standing on $floorId move to $toFloorId, then the floor is deleted
     * (chunks, objects, placed tokens, fog: FK CASCADE; links to it: NULL floor).
     *
     * @return list<int> ids of the sessions moved
     */
    public function remove(int $floorId, int $toFloorId): array;
}
