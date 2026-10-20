<?php

declare(strict_types=1);

namespace JDR\Domain\Support;

defined('JDR_BOOT') || exit;

/**
 * File system locations of the installation (registered by App::create()).
 */
final class AppPaths
{
    /**
     * @param string $publicRoot installation root (manifest.json, web-served files)
     * @param string $storage    storage directory (config storage_path)
     * @param string $codeRoot   root of the PHP code (migrations/), usually the same as $publicRoot
     */
    public function __construct(
        public readonly string $publicRoot,
        public readonly string $storage,
        public readonly string $codeRoot,
    ) {
    }
}
