<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class RateLimitedException extends HttpException
{
    public function __construct(int $retryAfterSeconds, string $message = '')
    {
        parent::__construct(429, 'rate_limited', $message, [], ['Retry-After' => (string) max(1, $retryAfterSeconds)]);
    }
}
