<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * Another process currently holds the migration lock.
 */
final class MigrationLockedException extends MigrationException
{
}
