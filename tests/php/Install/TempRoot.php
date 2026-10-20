<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

/**
 * Throw-away site root for installer tests (storage/ and, optionally, a link to the real migrations).
 */
final class TempRoot
{
    public static function create(bool $withMigrations = false): string
    {
        $root = sys_get_temp_dir() . '/jdr-root-' . bin2hex(random_bytes(6));
        mkdir($root . '/storage', 0700, true);
        if ($withMigrations) {
            symlink(\JDR_ROOT . '/migrations', $root . '/migrations');
        }

        return $root;
    }

    public static function remove(string $dir): void
    {
        if (is_link($dir)) {
            unlink($dir);

            return;
        }
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $path = $dir . '/' . $entry;
            is_dir($path) && !is_link($path) ? self::remove($path) : unlink($path);
        }
        rmdir($dir);
    }
}
