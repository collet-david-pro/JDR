<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;

/**
 * Identity of a projection screen (D1): cookie "jdr_display" = 32 random bytes in base64url (43
 * characters); only its SHA-256 is stored. The Auth middleware calls resolve() on the routes that
 * ask for a screen (route option display) and sets the request attribute "display".
 */
final class DisplayAuth
{
    public const COOKIE = 'jdr_display';
    public const LIFETIME = 30 * 86400;
    public const RENEW_AFTER = 86400;

    public function __construct(private DisplayRepository $displays)
    {
    }

    /**
     * The active screen holding the cookie, or null (absent, malformed, unknown token or row gone).
     */
    public function resolve(Request $request): ?Display
    {
        $raw = $request->cookies[self::COOKIE] ?? null;
        if (!is_string($raw) || preg_match('/^[A-Za-z0-9_-]{43}$/D', $raw) !== 1) {
            return null;
        }
        $display = $this->displays->findByTokenHash(self::hashToken($raw));

        return $display !== null && $display->isActive() ? $display : null;
    }

    public static function newToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * The Display of an authenticated request (attribute "display").
     */
    public static function of(Request $request): ?Display
    {
        $display = $request->attribute('display');

        return $display instanceof Display ? $display : null;
    }
}
