<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

/**
 * Password hashing and policy (projet.md 6.4): Argon2id when available, bcrypt cost 12 otherwise;
 * length 10..256; the 1000 most common passwords are refused.
 */
final class Passwords
{
    public const MIN_LENGTH = 10;
    public const MAX_LENGTH = 256;

    /** @var array<string, true>|null */
    private static ?array $common = null;

    public static function hash(string $password): string
    {
        return password_hash($password, self::algorithm(), self::options());
    }

    public static function verify(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, self::algorithm(), self::options());
    }

    /**
     * Returns the reason a password is refused (i18n key suffix), or null when acceptable.
     * Keys: too_short | too_long | too_common.
     */
    public static function policyError(string $password): ?string
    {
        $length = mb_strlen($password, 'UTF-8');
        if ($length < self::MIN_LENGTH) {
            return 'too_short';
        }
        if ($length > self::MAX_LENGTH) {
            return 'too_long';
        }
        if (isset(self::commonList()[mb_strtolower($password, 'UTF-8')])) {
            return 'too_common';
        }

        return null;
    }

    /**
     * Burns comparable time when the account does not exist (identical delays, 6.4).
     */
    public static function dummyVerify(string $password): void
    {
        static $dummy = null;
        $dummy ??= self::hash('dummy-password-for-timing');
        password_verify($password, $dummy);
    }

    private static function algorithm(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    /**
     * @return array<string, int>
     */
    private static function options(): array
    {
        return defined('PASSWORD_ARGON2ID') ? [] : ['cost' => 12];
    }

    /**
     * @return array<string, true>
     */
    private static function commonList(): array
    {
        if (self::$common === null) {
            self::$common = [];
            $lines = file(__DIR__ . '/common-passwords.txt', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            foreach ($lines as $line) {
                if ($line[0] !== '#') {
                    self::$common[$line] = true;
                }
            }
        }

        return self::$common;
    }
}
