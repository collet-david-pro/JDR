<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Records outgoing cookies instead of sending them (tests, CLI).
 */
final class MemoryCookieJar implements CookieJar
{
    /** @var array<string, array{value: string, expires: int, path: string, secure: bool, samesite: string}> */
    private array $sent = [];

    /** @var array<string, array{value: string, expires: int, path: string, secure: bool, samesite: string}> */
    private array $last = [];

    public function set(string $name, string $value, int $expires, string $path, bool $secure, string $sameSite = 'Lax'): void
    {
        $this->sent[$name] = ['value' => $value, 'expires' => $expires, 'path' => $path, 'secure' => $secure, 'samesite' => $sameSite];
        $this->last[$name] = $this->sent[$name];
    }

    /**
     * Last cookie set under this name, kept after drain() (to assert its attributes).
     *
     * @return array{value: string, expires: int, path: string, secure: bool, samesite: string}|null
     */
    public function last(string $name): ?array
    {
        return $this->last[$name] ?? null;
    }

    /**
     * Cookies set since the last call (then forgotten).
     *
     * @return array<string, array{value: string, expires: int, path: string, secure: bool, samesite: string}>
     */
    public function drain(): array
    {
        $sent = $this->sent;
        $this->sent = [];

        return $sent;
    }
}
