<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

final class MethodNotAllowedException extends HttpException
{
    /**
     * @param list<string> $allowed
     */
    public function __construct(private array $allowed = [])
    {
        parent::__construct(405, 'method_not_allowed', '', [], ['Allow' => implode(', ', $allowed)]);
    }

    /**
     * @return list<string>
     */
    public function allowed(): array
    {
        return $this->allowed;
    }
}
