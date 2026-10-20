<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * Minimal logger contract used by the migration engine and PHP migrations.
 * Kept independent from JDR\Core\Logger so the engine works from the
 * installer, update.php and the CLI alike.
 */
interface MigrationLogger
{
    /**
     * @param array<string, mixed> $ctx
     */
    public function info(string $msg, array $ctx = []): void;
}
