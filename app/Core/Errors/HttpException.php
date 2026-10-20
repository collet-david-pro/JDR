<?php

declare(strict_types=1);

namespace JDR\Core\Errors;

defined('JDR_BOOT') || exit;

/**
 * Base of all typed HTTP exceptions, converted to the JSON error envelope by ErrorHandler.
 * Not final: specialised by the exceptions of this namespace.
 * An empty message means "use the translated message errors.{code}".
 */
class HttpException extends \RuntimeException
{
    /**
     * @param array<string, mixed>  $fields
     * @param array<string, string> $headers
     */
    public function __construct(
        private int $status,
        private string $errorCode,
        string $message = '',
        private array $fields = [],
        private array $headers = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public function status(): int
    {
        return $this->status;
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    /**
     * @return array<string, mixed>
     */
    public function fields(): array
    {
        return $this->fields;
    }

    /**
     * @return array<string, string>
     */
    public function headers(): array
    {
        return $this->headers;
    }
}
