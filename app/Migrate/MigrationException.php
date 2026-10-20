<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * Base class of every error raised by the migration engine.
 */
class MigrationException extends \RuntimeException
{
}
