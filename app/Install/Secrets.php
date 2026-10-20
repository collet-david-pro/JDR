<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Secrets written to config.php (projet.md 6.4: app_secret = 64 random bytes).
 */
final class Secrets
{
    /** 64 random bytes, hex encoded (128 characters). */
    public static function appSecret(): string
    {
        return bin2hex(random_bytes(64));
    }

    /** 32 random bytes, URL-safe (43 characters), used as cron.php?key=... */
    public static function cronKey(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    /** Form token of the installer (32 random bytes, hex). */
    public static function token(): string
    {
        return bin2hex(random_bytes(32));
    }
}
