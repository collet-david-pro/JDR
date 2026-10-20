<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * HMAC-SHA256 signatures with app_secret (asset URLs, reset links, invitations).
 * Signed message = parts joined with "|" (e.g. uuid|t|e, projet.md 9.3). Signature is base64url.
 */
final class Signer
{
    private const DAY = 86400;

    public function __construct(private string $secret)
    {
        if (strlen($secret) < 16) {
            throw new \InvalidArgumentException('app_secret is missing or too short.');
        }
    }

    public function sign(string ...$parts): string
    {
        foreach ($parts as $part) {
            if (str_contains($part, '|')) {
                throw new \InvalidArgumentException('Signed parts must not contain "|".');
            }
        }

        return self::base64url(hash_hmac('sha256', implode('|', $parts), $this->secret, true));
    }

    public function verify(string $signature, string ...$parts): bool
    {
        try {
            return hash_equals($this->sign(...$parts), $signature);
        } catch (\InvalidArgumentException) {
            return false;
        }
    }

    /**
     * Signs parts followed by the expiration timestamp (last part).
     */
    public function signWithExpiry(int $expiresAt, string ...$parts): string
    {
        return $this->sign(...[...$parts, (string) $expiresAt]);
    }

    public function verifyWithExpiry(string $signature, int $expiresAt, int $now, string ...$parts): bool
    {
        if ($expiresAt < $now) {
            return false;
        }

        return $this->verify($signature, ...[...$parts, (string) $expiresAt]);
    }

    /**
     * Expiration "rounded to the next day + 1 day" (UTC): stable URL for the whole day.
     */
    public static function dailyExpiry(int $now): int
    {
        return intdiv($now, self::DAY) * self::DAY + 2 * self::DAY;
    }

    private static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
