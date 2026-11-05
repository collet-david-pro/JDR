<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

/**
 * Outcome of a pack import: counts of imported, skipped and failed items.
 */
final class ImportResult
{
    public function __construct(public readonly Asset $asset, public readonly bool $duplicate)
    {
    }
}
