<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class ValidationException extends HttpException
{
    /**
     * @param array<string, mixed> $fields
     */
    public function __construct(string $message = '', array $fields = [], string $code = 'validation_failed')
    {
        parent::__construct(422, $code, $message, $fields);
    }
}
