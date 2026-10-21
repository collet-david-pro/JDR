<?php

declare(strict_types=1);

namespace JDR\Zip;

defined('JDR_BOOT') || exit;

/**
 * Protections applied when reading an archive (zip bombs, huge directories).
 */
final class ZipLimits
{
    /**
     * @param int $maxEntries           entries in the central directory (directories included)
     * @param int $maxTotalBytes        sum of the declared uncompressed sizes
     * @param int $maxEntryBytes        uncompressed size of one entry
     * @param int $maxRatio             uncompressed / compressed size, for entries above $ratioThreshold
     * @param int $ratioThreshold       entries smaller than this are not ratio-checked
     */
    public function __construct(
        public readonly int $maxEntries = 10000,
        public readonly int $maxTotalBytes = 1073741824,
        public readonly int $maxEntryBytes = 104857600,
        public readonly int $maxRatio = 100,
        public readonly int $ratioThreshold = 65536,
    ) {
    }
}
