<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

/**
 * SMTP failure carrying the conversation log (without secrets), for the admin "send a test".
 */
final class SmtpLogException extends \RuntimeException
{
    /**
     * @param list<string> $log
     */
    public function __construct(string $message, private array $log, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }

    /**
     * @return list<string>
     */
    public function log(): array
    {
        return $this->log;
    }
}
