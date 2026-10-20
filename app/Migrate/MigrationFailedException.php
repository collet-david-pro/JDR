<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * A migration failed. Its row in schema_migrations has status "failed";
 * it can be run again once the cause is fixed.
 */
final class MigrationFailedException extends MigrationException
{
    public function __construct(
        public readonly string $version,
        public readonly string $name,
        string $message,
        ?\Throwable $previous = null
    ) {
        parent::__construct(sprintf('Migration %s_%s failed: %s', $version, $name, $message), 0, $previous);
    }
}
