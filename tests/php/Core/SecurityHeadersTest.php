<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\SecurityHeaders;
use PHPUnit\Framework\TestCase;

final class SecurityHeadersTest extends TestCase
{
    public function testCspMatchesSpecification(): void
    {
        self::assertSame(
            "default-src 'self'; script-src 'self' 'nonce-abc'; style-src 'self' 'unsafe-inline'; "
            . "img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; font-src 'self'; "
            . "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
            SecurityHeaders::csp('abc'),
        );
        self::assertStringNotContainsString('unsafe-eval', SecurityHeaders::csp('abc'));
    }

    public function testNonceIsRandomBase64(): void
    {
        $nonce = SecurityHeaders::nonce();
        self::assertMatchesRegularExpression('#^[A-Za-z0-9+/]{22}==$#', $nonce);
        self::assertNotSame($nonce, SecurityHeaders::nonce());
    }

    public function testHeadersWithoutHttps(): void
    {
        $headers = SecurityHeaders::headers('n', false);
        self::assertSame('nosniff', $headers['X-Content-Type-Options']);
        self::assertSame('same-origin', $headers['Referrer-Policy']);
        self::assertSame('DENY', $headers['X-Frame-Options']);
        self::assertSame('camera=(), microphone=(), geolocation=()', $headers['Permissions-Policy']);
        self::assertSame('same-origin', $headers['Cross-Origin-Opener-Policy']);
        self::assertStringContainsString("'nonce-n'", $headers['Content-Security-Policy']);
        self::assertArrayNotHasKey('Strict-Transport-Security', $headers);
    }

    public function testHstsOnlyWithHttps(): void
    {
        self::assertSame('max-age=15552000', SecurityHeaders::headers('n', true)['Strict-Transport-Security']);
    }
}
