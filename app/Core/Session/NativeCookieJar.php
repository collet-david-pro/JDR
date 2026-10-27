<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

final class NativeCookieJar implements CookieJar
{
    public function set(string $name, string $value, int $expires, string $path, bool $secure, string $sameSite = 'Lax'): void
    {
        if (headers_sent()) {
            return;
        }
        setcookie($name, $value, [
            'expires' => $expires,
            'path' => $path,
            'secure' => $secure,
            'httponly' => true,
            'samesite' => $sameSite,
        ]);
    }
}
