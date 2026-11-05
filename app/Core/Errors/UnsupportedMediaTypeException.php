<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

/**
 * HTTP 415 unsupported media type.
 */
final class UnsupportedMediaTypeException extends HttpException
{
    /**
     * @param array<string, mixed> $fields
     */
    public function __construct(string $message = '', array $fields = [], string $code = 'unsupported_type')
    {
        parent::__construct(415, $code, $message, $fields);
    }
}
