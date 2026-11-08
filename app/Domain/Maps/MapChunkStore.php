<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Maps\ChunkStore;

/**
 * ChunkStore of one map backed by map_chunks (SELECT ... FOR UPDATE).
 */
final class MapChunkStore implements ChunkStore
{
    public function __construct(private MapRepository $maps, private int $mapId, private ?MapFloorRepository $floors = null)
    {
    }

    /**
     * Selects and locks the chunks of a layer identified by their keys.
     */
    public function lock(int $floorId, string $layer, array $keys): array
    {
        return $this->maps->chunksForUpdate($this->mapId, $floorId, $layer, $keys);
    }

    /**
     * Selects and locks the chunks lying beyond the given chunk coordinates.
     */
    public function lockAll(): array
    {
        return $this->maps->chunksAllForUpdate($this->mapId);
    }

    public function lockBeyond(int $minCx, int $minCy): array
    {
        return $this->maps->chunksBeyondForUpdate($this->mapId, $minCx, $minCy);
    }

    /**
     * Selects and locks (FOR UPDATE) every chunk of the floor.
     *
     * @throws \LogicException When no floor repository was provided.
     */
    public function lockFloor(int $floorId): array
    {
        return ($this->floors ?? throw new \LogicException('No floor repository.'))->chunksForUpdate($this->mapId, $floorId);
    }
}
