<?php

declare(strict_types=1);

namespace JDR\Zip;

defined('JDR_BOOT') || exit;

/**
 * Invalid, unsupported or dangerous ZIP archive. reason() is a stable identifier
 * (e.g. "unsafe_path", "too_many_entries", "compression_ratio") for logs, tests and reports.
 */
final class ZipException extends \RuntimeException
{
    public function __construct(private string $reason, string $message = '')
    {
        parent::__construct($message !== '' ? $message : 'Invalid ZIP archive: ' . $reason);
    }

    public function reason(): string
    {
        return $this->reason;
    }
}
