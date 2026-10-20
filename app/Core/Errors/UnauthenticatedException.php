<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class UnauthenticatedException extends HttpException
{
    /**
     * @param array<string, mixed> $fields
     */
    public function __construct(string $message = '', array $fields = [], string $code = 'unauthenticated')
    {
        parent::__construct(401, $code, $message, $fields);
    }
}
