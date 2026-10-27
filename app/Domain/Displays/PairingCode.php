<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Signer;

/**
 * The 6-digit pairing code of a screen (D2): random, stored only as an HMAC (app_secret), valid
 * 10 minutes. Never logged.
 */
final class PairingCode
{
    public const LIFETIME = 600;

    public function __construct(private Signer $signer)
    {
    }

    public function generate(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    public function hash(string $code): string
    {
        return $this->signer->sign('display-pair', $code);
    }

    /**
     * The 6 digits of what the user typed (spaces and dashes ignored), or null.
     */
    public static function normalize(mixed $raw): ?string
    {
        if (!is_string($raw) || strlen($raw) > 32) {
            return null;
        }
        $code = str_replace([' ', '-'], '', $raw);

        return preg_match('/^[0-9]{6}$/D', $code) === 1 ? $code : null;
    }
}
