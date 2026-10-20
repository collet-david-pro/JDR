<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Records outgoing cookies instead of sending them (tests, CLI).
 */
final class MemoryCookieJar implements CookieJar
{
    /** @var array<string, array{value: string, expires: int, path: string, secure: bool}> */
    private array $sent = [];

    public function set(string $name, string $value, int $expires, string $path, bool $secure): void
    {
        $this->sent[$name] = ['value' => $value, 'expires' => $expires, 'path' => $path, 'secure' => $secure];
    }

    /**
     * Cookies set since the last call (then forgotten).
     *
     * @return array<string, array{value: string, expires: int, path: string, secure: bool}>
     */
    public function drain(): array
    {
        $sent = $this->sent;
        $this->sent = [];

        return $sent;
    }
}
