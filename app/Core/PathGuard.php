<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Third line of defence for private paths (after .htaccess and per-folder index.php),
 * used by the front controller under "php -S" (which ignores .htaccess) and by the kernel.
 */
final class PathGuard
{
    /** Private top-level directories (lower case). */
    private const DIRS = [
        'app', 'storage', 'migrations', 'i18n', 'dev', 'tests', 'frontend', 'etapes', 'docs',
        'node_modules', 'dist', 'vendor',
    ];

    /** Private top-level files (lower case). */
    private const FILES = [
        'config.php', 'config.example.php', 'projet.md', 'phpunit.xml', 'phpcs.xml',
        'package.json', 'package-lock.json', 'composer.json', 'composer.lock',
    ];

    /** The only PHP scripts reachable over HTTP. */
    private const PUBLIC_PHP = ['index.php', 'install.php', 'update.php', 'cron.php'];

    /**
     * @param string $urlPath URL path relative to the base path (raw or decoded)
     */
    public static function isPrivate(string $urlPath): bool
    {
        $path = strtolower(rawurldecode($urlPath));
        if (str_contains($path, "\0") || str_contains($path, '\\')) {
            return true;
        }
        $segments = array_values(array_filter(explode('/', $path), static fn (string $s): bool => $s !== ''));
        if ($segments === []) {
            return false;
        }
        foreach ($segments as $i => $segment) {
            if ($segment === '..' || $segment === '.') {
                return true;
            }
            if (str_starts_with($segment, '.') && $segment !== '.well-known') {
                return true;
            }
            // Trailing dots/spaces are ignored by some file systems ("app.", "config.php ").
            $segments[$i] = rtrim($segment, ' .');
        }
        $first = $segments[0];
        if (in_array($first, self::DIRS, true)) {
            return true;
        }
        if (count($segments) === 1 && in_array($first, self::FILES, true)) {
            return true;
        }
        $last = $segments[count($segments) - 1];
        if (str_ends_with($last, '.php') || preg_match('/\.(phtml|phar|php\d)$/', $last) === 1) {
            return !(count($segments) === 1 && in_array($last, self::PUBLIC_PHP, true));
        }

        return false;
    }
}
