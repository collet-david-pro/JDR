<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Cookie jar that emits cookies with PHP's setcookie().
 */
final class NativeCookieJar implements CookieJar
{
    /**
     * Sends a Set-Cookie header with the given attributes.
     */
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
