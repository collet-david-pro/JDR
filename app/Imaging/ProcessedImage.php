<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Result of ImagePipeline::process(): the final (cleaned / re-encoded) file and its thumbnail,
 * both written in the work directory given to the pipeline. The caller moves or deletes them.
 * sha256 and sizeBytes describe the FINAL file, not the uploaded one.
 */
final class ProcessedImage
{
    public function __construct(
        public readonly string $path,
        public readonly string $mime,
        public readonly string $ext,
        public readonly int $width,
        public readonly int $height,
        public readonly bool $isAnimated,
        public readonly int $frameCount,
        public readonly int $durationMs,
        public readonly int $sizeBytes,
        public readonly string $sha256,
        public readonly string $thumbPath,
        public readonly string $thumbMime,
        public readonly int $thumbSizeBytes,
    ) {
    }
}
