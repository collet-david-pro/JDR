<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

final class HttpResult
{
    public function __construct(public readonly int $status, public readonly string $body)
    {
    }

    /**
     * Decoded JSON body, or null when the body is not a JSON object.
     *
     * @return array<string, mixed>|null
     */
    public function json(): ?array
    {
        try {
            $data = json_decode($this->body, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return is_array($data) ? $data : null;
    }
}
