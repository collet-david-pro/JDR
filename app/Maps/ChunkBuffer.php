<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * A chunk being edited by OpsApplier: raw block (4 104 bytes, see ChunkCodec), whether a row
 * already exists in map_chunks, whether it was changed.
 */
final class ChunkBuffer
{
    public bool $dirty = false;

    public function __construct(
        public readonly int $floorId,
        public readonly string $layer,
        public readonly int $cx,
        public readonly int $cy,
        public string $raw,
        public readonly bool $existed,
    ) {
    }

    public static function key(int $floorId, string $layer, int $cx, int $cy): string
    {
        return $floorId . '|' . $layer . '|' . $cx . ':' . $cy;
    }
}
