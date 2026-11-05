<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

/**
 * Raised when the SMTP conversation fails.
 */
final class SmtpException extends \RuntimeException
{
}
