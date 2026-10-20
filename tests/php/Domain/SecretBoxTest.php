<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Domain\Settings\SecretBox;
use PHPUnit\Framework\TestCase;

final class SecretBoxTest extends TestCase
{
    public function testRoundTripAndKeySeparation(): void
    {
        $box = new SecretBox(str_repeat('a', 64));
        $encrypted = $box->encrypt('Sm7p p@ss — é');
        self::assertStringStartsWith(function_exists('sodium_crypto_secretbox') ? 's1:' : 'o1:', $encrypted);
        self::assertStringNotContainsString('Sm7p', $encrypted);
        self::assertNotSame($encrypted, $box->encrypt('Sm7p p@ss — é'), 'random nonce');
        self::assertSame('Sm7p p@ss — é', $box->decrypt($encrypted));
        self::assertNull((new SecretBox(str_repeat('b', 64)))->decrypt($encrypted));
        self::assertNull($box->decrypt('s1:!!!'));
        self::assertNull($box->decrypt('s1:' . base64_encode('short')));
        self::assertNull($box->decrypt('zz:abc'));
    }

    public function testOpenSslFormatIsReadable(): void
    {
        if (!function_exists('openssl_encrypt')) {
            self::markTestSkipped('openssl missing');
        }
        $secret = str_repeat('a', 64);
        $key = hash_hkdf('sha256', $secret, 32, 'jdr-secretbox-v1');
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt('hello', 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        self::assertSame('hello', (new SecretBox($secret))->decrypt('o1:' . base64_encode($iv . $tag . $cipher)));
    }
}
