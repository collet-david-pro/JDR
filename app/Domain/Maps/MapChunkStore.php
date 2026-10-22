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
    public function __construct(private MapRepository $maps, private int $mapId)
    {
    }

    public function lock(int $floorId, string $layer, array $keys): array
    {
        return $this->maps->chunksForUpdate($this->mapId, $floorId, $layer, $keys);
    }

    public function lockBeyond(int $minCx, int $minCy): array
    {
        return $this->maps->chunksBeyondForUpdate($this->mapId, $minCx, $minCy);
    }
}
