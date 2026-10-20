<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * An already applied migration file has been modified: the engine refuses
 * to continue (projet.md §8.1: a delivered migration is never modified).
 */
final class ChecksumMismatchException extends MigrationException
{
    public function __construct(
        public readonly string $version,
        public readonly string $name,
        public readonly string $expected,
        public readonly string $actual
    ) {
        parent::__construct(sprintf(
            'Migration %s_%s has been modified after being applied (expected checksum %s, found %s). '
            . 'A delivered migration must never be modified: restore the original file.',
            $version,
            $name,
            $expected,
            $actual
        ));
    }
}
