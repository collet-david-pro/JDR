<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Session cookie and lifetime parameters (projet.md 6.4).
 */
final class SessionOptions
{
    public const COOKIE_NAME = 'jdr_sid';
    public const ABSOLUTE_SECONDS = 7 * 86400;
    public const REGENERATE_SECONDS = 1800;

    public function __construct(
        public readonly string $path,
        public readonly bool $secure,
        public readonly int $idleSeconds,
        public readonly int $absoluteSeconds = self::ABSOLUTE_SECONDS,
        public readonly int $regenerateSeconds = self::REGENERATE_SECONDS,
        public readonly string $name = self::COOKIE_NAME,
    ) {
    }
}
