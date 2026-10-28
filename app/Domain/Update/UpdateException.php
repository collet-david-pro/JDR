<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\HttpException;

/**
 * Refusal of the update module. Code = stable identifier ("update.unsafe_path"...), message in French
 * (UpdateText "error.<code>"), fields = details for the API envelope (path, reason, received...).
 */
final class UpdateException extends HttpException
{
    /**
     * @param array<string, mixed> $fields
     */
    public function __construct(string $code, array $fields = [], int $status = 422, string $message = '')
    {
        parent::__construct($status, $code, $message !== '' ? $message : UpdateText::error($code, $fields), $fields);
    }
}
