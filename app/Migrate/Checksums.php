<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * SHA-256 fingerprints of migration files.
 *
 * Line endings are normalized to LF before hashing so that an FTP client
 * uploading in ASCII mode (CRLF conversion) does not block an update.
 */
final class Checksums
{
    public static function ofFile(string $path): string
    {
        $content = @file_get_contents($path);
        if ($content === false) {
            throw new MigrationException('Cannot read migration file: ' . basename($path));
        }

        return self::ofString($content);
    }

    public static function ofString(string $content): string
    {
        return hash('sha256', str_replace(["\r\n", "\r"], "\n", $content));
    }
}
