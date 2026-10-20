<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Security headers sent on every response (projet.md 6.4). Never add 'unsafe-eval'.
 */
final class SecurityHeaders
{
    public const HSTS = 'max-age=15552000';

    public static function nonce(): string
    {
        return base64_encode(random_bytes(16));
    }

    public static function csp(string $nonce): string
    {
        return implode('; ', [
            "default-src 'self'",
            "script-src 'self' 'nonce-" . $nonce . "'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' blob: data:",
            "worker-src 'self' blob:",
            "connect-src 'self'",
            "font-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
        ]);
    }

    /**
     * @return array<string, string>
     */
    public static function headers(string $nonce, bool $https): array
    {
        $headers = [
            'Content-Security-Policy' => self::csp($nonce),
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'same-origin',
            'X-Frame-Options' => 'DENY',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
            'Cross-Origin-Opener-Policy' => 'same-origin',
        ];
        if ($https) {
            $headers['Strict-Transport-Security'] = self::HSTS;
        }

        return $headers;
    }
}
