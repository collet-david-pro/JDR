<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Maps\FloorStore;

/**
 * FloorStore of one map backed by map_floors.
 */
final class MapFloorStore implements FloorStore
{
    public function __construct(private MapRepository $maps, private MapFloorRepository $floors, private int $mapId)
    {
    }

    public function insert(string $uid, int $level, string $name, int $sortOrder): int
    {
        return $this->maps->insertFloor($this->mapId, $uid, $level, $name, $sortOrder);
    }

    public function update(int $floorId, array $fields): void
    {
        $this->floors->update($floorId, $fields);
    }

    public function remove(int $floorId, int $toFloorId): array
    {
        $moved = $this->floors->moveSessions($this->mapId, $floorId, $toFloorId);
        $this->floors->delete($floorId);

        return $moved;
    }
}
