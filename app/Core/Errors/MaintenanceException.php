<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class MaintenanceException extends HttpException
{
    public const RETRY_AFTER = 120;

    /**
     * @param bool $updatePending the database is behind the code: the page offers update.php to administrators
     * @param string|null $updateUrl set for an administrator only: the body then carries fields.update_url
     */
    public function __construct(string $message = '', public readonly bool $updatePending = false, ?string $updateUrl = null)
    {
        parent::__construct(503, 'maintenance', $message, $updateUrl === null ? [] : ['update_url' => $updateUrl], ['Retry-After' => (string) self::RETRY_AFTER]);
    }
}
