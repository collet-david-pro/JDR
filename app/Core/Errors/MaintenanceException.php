<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class MaintenanceException extends HttpException
{
    public const RETRY_AFTER = 120;

    /**
     * @param bool $updatePending the database is behind the code: the page offers update.php to administrators
     */
    public function __construct(string $message = '', public readonly bool $updatePending = false)
    {
        parent::__construct(503, 'maintenance', $message, [], ['Retry-After' => (string) self::RETRY_AFTER]);
    }
}
