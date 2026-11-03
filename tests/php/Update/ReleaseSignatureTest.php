<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Domain\Update\ReleaseSignature;
use PHPUnit\Framework\TestCase;

final class ReleaseSignatureTest extends TestCase
{
    public function testValidInvalidAndMalformedSignatures(): void
    {
        $pair = sodium_crypto_sign_keypair();
        $sig = new ReleaseSignature(base64_encode(sodium_crypto_sign_publickey($pair)));
        $sums = str_repeat('a', 64) . "  jdr-update-v0.3.0.zip\n";
        $good = base64_encode(sodium_crypto_sign_detached($sums, sodium_crypto_sign_secretkey($pair)));

        self::assertTrue($sig->available());
        self::assertTrue($sig->verify($sums, $good . "\n"));
        self::assertFalse($sig->verify($sums . ' ', $good));
        self::assertFalse($sig->verify($sums, ''));
        self::assertFalse($sig->verify($sums, 'not base64 !'));
        self::assertFalse($sig->verify($sums, base64_encode('short')));
        $other = sodium_crypto_sign_keypair();
        self::assertFalse((new ReleaseSignature(base64_encode(sodium_crypto_sign_publickey($other))))->verify($sums, $good));
    }

    public function testPlaceholderKeyAndMissingSodiumNeverVerify(): void
    {
        $pair = sodium_crypto_sign_keypair();
        $sums = "x\n";
        $good = base64_encode(sodium_crypto_sign_detached($sums, sodium_crypto_sign_secretkey($pair)));
        self::assertFalse((new ReleaseSignature())->verify($sums, $good)); // placeholder PUBLIC_KEY
        self::assertFalse((new ReleaseSignature(base64_encode(sodium_crypto_sign_publickey($pair)), false))->verify($sums, $good));
    }

    public function testWhichReleasesAreSigned(): void
    {
        self::assertFalse(ReleaseSignature::expectedFor('0.2.0'));
        self::assertFalse(ReleaseSignature::expectedFor('0.1.0-alpha.2'));
        self::assertTrue(ReleaseSignature::expectedFor('0.2.1'));
        self::assertTrue(ReleaseSignature::expectedFor('0.3.0-beta.1'));
    }
}
