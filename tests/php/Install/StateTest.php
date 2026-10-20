<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\State;
use PHPUnit\Framework\TestCase;

final class StateTest extends TestCase
{
    public function testEncryptedBlobHidesSecretsAndRoundTrips(): void
    {
        $key = random_bytes(32);
        $data = ['db' => ['pass' => 'S3cr3t-DB-pass'], 'n' => 1];
        $blob = State::encrypt($data, $key);

        self::assertStringStartsWith('e:', $blob);
        self::assertStringNotContainsString('S3cr3t', $blob);
        self::assertStringNotContainsString('S3cr3t', (string) base64_decode(substr($blob, 2)));
        self::assertSame($data, State::decrypt($blob, $key));
    }

    public function testWrongKeyOrTamperingGivesNothing(): void
    {
        $blob = State::encrypt(['a' => 1], random_bytes(32));
        self::assertNull(State::decrypt($blob, random_bytes(32)));

        $key = random_bytes(32);
        $blob = State::encrypt(['a' => 1], $key);
        $raw = (string) base64_decode(substr($blob, 2));
        $raw[strlen($raw) - 1] = chr(ord($raw[strlen($raw) - 1]) ^ 1);
        self::assertNull(State::decrypt('e:' . base64_encode($raw), $key));
        self::assertNull(State::decrypt('garbage', $key));
    }

    public function testTokenIsStableAndCheckedInConstantTime(): void
    {
        $state = State::memory();
        $token = $state->token();
        self::assertSame($token, $state->token());
        self::assertTrue($state->checkToken($token));
        self::assertFalse($state->checkToken(''));
        self::assertFalse($state->checkToken(null));
        self::assertFalse($state->checkToken(['x']));
        self::assertFalse($state->checkToken(str_repeat('0', 64)));
    }
}
