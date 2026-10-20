<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\Secrets;
use PHPUnit\Framework\TestCase;

final class SecretsTest extends TestCase
{
    public function testAppSecretIs64RandomBytesInHex(): void
    {
        $a = Secrets::appSecret();
        self::assertMatchesRegularExpression('/^[0-9a-f]{128}$/', $a);
        self::assertNotSame($a, Secrets::appSecret());
    }

    public function testCronKeyIsUrlSafe(): void
    {
        $k = Secrets::cronKey();
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $k);
        self::assertSame($k, rawurlencode($k));
        self::assertNotSame($k, Secrets::cronKey());
    }

    public function testFormToken(): void
    {
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', Secrets::token());
    }
}
