<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class MaintenanceException extends HttpException
{
    public const RETRY_AFTER = 120;

    public function __construct(string $message = '')
    {
        parent::__construct(503, 'maintenance', $message, [], ['Retry-After' => (string) self::RETRY_AFTER]);
    }
}
