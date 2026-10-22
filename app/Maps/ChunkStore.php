<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Source of the stored chunks of one map for OpsApplier. Implementations lock what they return
 * until the end of the transaction (SELECT ... FOR UPDATE).
 */
interface ChunkStore
{
    /**
     * Existing chunks among $keys of one floor/layer.
     *
     * @param list<array{0: int, 1: int}> $keys [cx, cy]
     * @return array<string, string> "cx:cy" => compressed data
     */
    public function lock(int $floorId, string $layer, array $keys): array;

    /**
     * Every chunk (all floors and layers) with cx >= $minCx or cy >= $minCy.
     *
     * @return list<array{floor_id: int, layer: string, cx: int, cy: int, data: string}>
     */
    public function lockBeyond(int $minCx, int $minCy): array;
}
