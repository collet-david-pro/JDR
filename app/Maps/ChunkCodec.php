<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Tile chunk codec, server side (projet.md 12.2), byte-compatible with
 * frontend/src/formats/chunk-codec.ts.
 *
 * Raw block = 4 104 bytes: 8-byte header ("J", "C", version u8 = 1, layer u8 (0 ground,
 * 1 terrain, 2 decor), 4 reserved bytes = 0) then 1 024 cells row by row (cell i = x + 32 y),
 * 4 bytes each: palette_index u16 LE, variant u8, flags u8. Stored compressed with raw deflate
 * (gzdeflate level 6); decompression is bounded (anti-bomb) and every block read is checked:
 * exact size, magic, version, layer, palette index < palette size.
 *
 * Raw blocks are handled as PHP binary strings; cells are changed in place.
 */
final class ChunkCodec
{
    public const SIZE = 32;
    public const CELLS = 1024;
    public const HEADER_BYTES = 8;
    public const RAW_BYTES = 4104;
    public const VERSION = 1;
    public const LEVEL = 6;

    /** Tile layer => header code. */
    public const LAYERS = ['ground' => 0, 'terrain' => 1, 'decor' => 2];

    private const MAGIC = 'JC';

    /**
     * Header code of a tile layer.
     *
     * @throws ChunkCodecException bad_layer
     */
    public static function layerCode(string $layer): int
    {
        return self::LAYERS[$layer] ?? throw new ChunkCodecException('bad_layer', 'Unknown tile layer ' . $layer);
    }

    /**
     * Tile layer of a header code, null when unknown.
     */
    public static function layerName(int $code): ?string
    {
        $name = array_search($code, self::LAYERS, true);

        return is_string($name) ? $name : null;
    }

    /**
     * Raw block whose cells are all empty.
     */
    public static function emptyRaw(string $layer): string
    {
        return self::MAGIC . chr(self::VERSION) . chr(self::layerCode($layer)) . "\0\0\0\0"
            . str_repeat("\0", self::CELLS * 4);
    }

    /**
     * Compressed (raw deflate) form of a raw block.
     */
    public static function compress(string $raw): string
    {
        if (strlen($raw) !== self::RAW_BYTES) {
            throw new ChunkCodecException('bad_size', 'Raw block must be ' . self::RAW_BYTES . ' bytes');
        }
        $data = gzdeflate($raw, self::LEVEL);
        if ($data === false) {
            throw new ChunkCodecException('bad_compression', 'gzdeflate failed');
        }

        return $data;
    }

    /**
     * Bounded decompression: never more than RAW_BYTES (+ zlib slack) are produced, and the
     * result must be exactly RAW_BYTES long.
     *
     * @throws ChunkCodecException bad_compression | bad_size
     */
    public static function inflate(string $data): string
    {
        if ($data === '') {
            throw new ChunkCodecException('bad_compression', 'Empty block data');
        }
        $raw = @gzinflate($data, self::RAW_BYTES);
        if ($raw === false) {
            throw new ChunkCodecException('bad_compression', 'Invalid or oversized raw deflate data');
        }
        if (strlen($raw) !== self::RAW_BYTES) {
            throw new ChunkCodecException('bad_size', 'Expected ' . self::RAW_BYTES . ' bytes, got ' . strlen($raw));
        }

        return $raw;
    }

    /**
     * Decompresses and checks a stored or received block.
     *
     * @param string|null $layer expected tile layer (null: any)
     * @param int         $paletteSize every non-empty index must be < $paletteSize
     * @throws ChunkCodecException
     */
    public static function decode(string $data, ?string $layer, int $paletteSize): string
    {
        $raw = self::inflate($data);
        self::check($raw, $layer, $paletteSize);

        return $raw;
    }

    /**
     * Checks a raw block (12.2): size, magic, version, layer, palette indexes.
     *
     * @throws ChunkCodecException bad_size | bad_magic | bad_version | bad_layer | bad_palette_index
     */
    public static function check(string $raw, ?string $layer, int $paletteSize): void
    {
        if (strlen($raw) !== self::RAW_BYTES) {
            throw new ChunkCodecException('bad_size', 'Expected ' . self::RAW_BYTES . ' bytes, got ' . strlen($raw));
        }
        if (substr($raw, 0, 2) !== self::MAGIC) {
            throw new ChunkCodecException('bad_magic', 'Bad magic');
        }
        if (ord($raw[2]) !== self::VERSION) {
            throw new ChunkCodecException('bad_version', 'Unsupported chunk version ' . ord($raw[2]));
        }
        $name = self::layerName(ord($raw[3]));
        if ($name === null || ($layer !== null && $name !== $layer)) {
            throw new ChunkCodecException('bad_layer', 'Unexpected layer code ' . ord($raw[3]));
        }
        if ($paletteSize > 0xffff) {
            return;
        }
        $indexes = unpack('v*', self::indexBytes($raw));
        foreach ($indexes === false ? [] : $indexes as $i => $index) {
            if ($index !== 0 && $index >= $paletteSize) {
                throw new ChunkCodecException('bad_palette_index', 'Cell ' . ($i - 1) . ': palette index ' . $index . ' too large');
            }
        }
    }

    /**
     * Layer of a raw block (header byte).
     */
    public static function layerOf(string $raw): ?string
    {
        return strlen($raw) >= 4 ? self::layerName(ord($raw[3])) : null;
    }

    /**
     * Byte offset of cell (x, y) of the block, x and y in 0..31.
     */
    public static function offset(int $x, int $y): int
    {
        return self::HEADER_BYTES + (($y << 5) | $x) * 4;
    }

    public static function indexAt(string $raw, int $offset): int
    {
        return ord($raw[$offset]) | (ord($raw[$offset + 1]) << 8);
    }

    /**
     * [index, variant, flags] of a cell; an empty cell reads as [0, 0, 0].
     *
     * @return array{0: int, 1: int, 2: int}
     */
    public static function cellAt(string $raw, int $offset): array
    {
        $index = self::indexAt($raw, $offset);

        return $index === 0 ? [0, 0, 0] : [$index, ord($raw[$offset + 2]), ord($raw[$offset + 3])];
    }

    /**
     * Writes a cell in place (an empty cell is written as four zero bytes).
     */
    public static function setCell(string &$raw, int $offset, int $index, int $variant, int $flags): void
    {
        if ($index === 0) {
            $variant = 0;
            $flags = 0;
        }
        $raw[$offset] = chr($index & 0xff);
        $raw[$offset + 1] = chr($index >> 8);
        $raw[$offset + 2] = chr($variant);
        $raw[$offset + 3] = chr($flags);
    }

    /**
     * True when every cell is empty (index 0).
     */
    public static function isEmpty(string $raw): bool
    {
        $cells = substr($raw, self::HEADER_BYTES);
        if ($cells === str_repeat("\0", self::CELLS * 4)) {
            return true;
        }

        return trim(self::indexBytes($raw), "\0") === '';
    }

    /**
     * Number of cells per non-empty palette index.
     *
     * @return array<int, int>
     */
    public static function indexCounts(string $raw): array
    {
        $indexes = unpack('v*', self::indexBytes($raw));
        $counts = array_count_values($indexes === false ? [] : $indexes);
        unset($counts[0]);

        return $counts;
    }

    /**
     * The 1 024 palette indexes, packed (2 bytes each, LE).
     */
    private static function indexBytes(string $raw): string
    {
        $out = '';
        for ($o = self::HEADER_BYTES; $o < self::RAW_BYTES; $o += 4) {
            $out .= $raw[$o] . $raw[$o + 1];
        }

        return $out;
    }
}
