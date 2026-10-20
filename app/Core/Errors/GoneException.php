<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class GoneException extends HttpException
{
    /**
     * @param array<string, mixed> $fields
     */
    public function __construct(string $message = '', array $fields = [], string $code = 'events_gone')
    {
        parent::__construct(410, $code, $message, $fields);
    }
}
