<?php

declare(strict_types=1);

namespace JDR\Zip;

defined('JDR_BOOT') || exit;

/**
 * One entry of the central directory, as validated by ZipReader.
 */
final class ZipEntry
{
    public function __construct(
        public readonly int $index,
        public readonly string $name,
        public readonly int $method,
        public readonly int $crc32,
        public readonly int $compressedSize,
        public readonly int $size,
        public readonly int $localHeaderOffset,
        public readonly bool $isDir,
    ) {
    }
}
