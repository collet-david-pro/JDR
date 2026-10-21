<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Structural analysis of an image file by one of the format parsers (internal to the pipeline).
 */
final class ParsedImage
{
    /**
     * @param list<array{0: int, 1: int}> $opaqueRanges [offset, length] of compressed pixel data
     *        (IDAT, JPEG scans, LZW blocks, VP8/VP8L/ALPH), skipped by the short trap patterns
     * @param string|null $cleanData rewritten file (GIF / WebP containers), null otherwise
     * @param array{data: string, x: int, y: int, canvasWidth: int, canvasHeight: int}|null $firstFrame
     *        first frame of an animated WebP rebuilt as a static WebP, with its canvas position
     */
    public function __construct(
        public readonly int $width,
        public readonly int $height,
        public readonly int $frameCount = 1,
        public readonly int $durationMs = 0,
        public readonly bool $animated = false,
        public readonly int $orientation = 1,
        public readonly bool $lossless = false,
        public readonly bool $isApng = false,
        public readonly ?string $cleanData = null,
        public readonly array $opaqueRanges = [],
        public readonly ?array $firstFrame = null,
    ) {
    }
}
