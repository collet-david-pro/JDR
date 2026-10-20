<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Signer;
use PHPUnit\Framework\TestCase;

final class SignerTest extends TestCase
{
    private const SECRET = '0123456789abcdef0123456789abcdef';

    public function testSignatureIsDeterministicBase64Url(): void
    {
        $signer = new Signer(self::SECRET);
        $sig = $signer->sign('uuid-1', 'full', '1700000000');
        self::assertSame($sig, $signer->sign('uuid-1', 'full', '1700000000'));
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $sig);
        $expected = rtrim(strtr(base64_encode(
            hash_hmac('sha256', 'uuid-1|full|1700000000', self::SECRET, true),
        ), '+/', '-_'), '=');
        self::assertSame($expected, $sig);
    }

    public function testVerifyDetectsTampering(): void
    {
        $signer = new Signer(self::SECRET);
        $sig = $signer->sign('uuid-1', 'thumb', '100');
        self::assertTrue($signer->verify($sig, 'uuid-1', 'thumb', '100'));
        self::assertFalse($signer->verify($sig, 'uuid-1', 'full', '100'));
        self::assertFalse($signer->verify($sig, 'uuid-2', 'thumb', '100'));
        self::assertFalse($signer->verify($sig . 'x', 'uuid-1', 'thumb', '100'));
        self::assertFalse((new Signer(str_repeat('z', 32)))->verify($sig, 'uuid-1', 'thumb', '100'));
    }

    public function testSeparatorInPartsIsRejected(): void
    {
        $signer = new Signer(self::SECRET);
        self::assertFalse($signer->verify('x', 'a|b'));
        $this->expectException(\InvalidArgumentException::class);
        $signer->sign('a|b');
    }

    public function testExpiry(): void
    {
        $signer = new Signer(self::SECRET);
        $sig = $signer->signWithExpiry(1000, 'uuid', 'full');
        self::assertSame($signer->sign('uuid', 'full', '1000'), $sig);
        self::assertTrue($signer->verifyWithExpiry($sig, 1000, 999, 'uuid', 'full'));
        self::assertTrue($signer->verifyWithExpiry($sig, 1000, 1000, 'uuid', 'full'));
        self::assertFalse($signer->verifyWithExpiry($sig, 1000, 1001, 'uuid', 'full'));
        self::assertFalse($signer->verifyWithExpiry($sig, 2000, 999, 'uuid', 'full'));
    }

    public function testDailyExpiryIsNextDayPlusOneDay(): void
    {
        $now = gmmktime(15, 30, 0, 10, 20, 2026);
        self::assertSame(gmmktime(0, 0, 0, 10, 22, 2026), Signer::dailyExpiry($now));
        // Stable for the whole day.
        self::assertSame(Signer::dailyExpiry(gmmktime(0, 0, 0, 10, 20, 2026)), Signer::dailyExpiry($now));
        self::assertSame(Signer::dailyExpiry(gmmktime(23, 59, 59, 10, 20, 2026)), Signer::dailyExpiry($now));
    }

    public function testShortSecretIsRefused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Signer('short');
    }
}
