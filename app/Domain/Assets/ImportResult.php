<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

final class ImportResult
{
    public function __construct(public readonly Asset $asset, public readonly bool $duplicate)
    {
    }
}
