<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Outgoing cookies (remember-me, session cookie of the memory backend).
 * Response holds a single value per header name, so cookies go through this service:
 * NativeCookieJar calls setcookie(), MemoryCookieJar records them (tests).
 */
interface CookieJar
{
    /**
     * Sets (or, with $expires in the past and an empty value, deletes) a cookie.
     * Always HttpOnly and SameSite=Lax.
     */
    public function set(string $name, string $value, int $expires, string $path, bool $secure): void;
}
