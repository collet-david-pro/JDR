<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\HttpException;
use JDR\Domain\Update\UpdateText;

/**
 * Refusal of the backup module: code "backup.*", French message from the update strings
 * (strings.fr.php "error.backup.*"), fields = details for the API envelope.
 */
final class BackupException extends HttpException
{
    /**
     * @param array<string, mixed> $fields
     */
    public function __construct(string $code, array $fields = [], int $status = 422)
    {
        parent::__construct($status, $code, UpdateText::error($code, $fields), $fields);
    }

    /**
     * @param array<string, mixed> $fields
     */
    public static function invalid(string $reason, array $fields = []): self
    {
        return new self('backup.invalid_file', ['reason' => $reason] + $fields);
    }
}
