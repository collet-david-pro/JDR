<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * What an update archive may contain and what the update may touch on disk
 * (mirror of dev/release.mjs: ROOT_FILES / ROOT_DIRS, minus install.php and storage/).
 */
final class PackageRules
{
    public const MANIFEST = 'manifest.json';

    /** Files accepted at the root of the archive. */
    public const ROOT_FILES = ['index.php', 'update.php', 'cron.php', '.htaccess', 'VERSION', 'CHANGELOG.md', 'LICENSE.md', 'sw.js', self::MANIFEST];

    /** Directories accepted (recursively). */
    public const ROOT_DIRS = ['assets', 'app', 'migrations', 'i18n'];

    /** Code of the updater itself: written last during the copy (and restored last on rollback). */
    public const SELF_PREFIX = 'app/Domain/Update/';

    /**
     * Never written, removed nor accepted, whatever the archive or the manifests say.
     */
    public static function isProtected(string $path): bool
    {
        $lower = strtolower($path);

        return $lower === 'config.php'
            || $lower === 'install.php'
            || $lower === 'storage' || str_starts_with($lower, 'storage/')
            || $lower === '.git' || str_starts_with($lower, '.git/')
            || str_contains($lower, '/.git/');
    }

    /**
     * Path the update may write or delete: a shipped root file, or a file under a shipped directory.
     */
    public static function isAllowed(string $path): bool
    {
        if (self::isProtected($path) || !self::isSafe($path)) {
            return false;
        }
        if (in_array($path, self::ROOT_FILES, true)) {
            return true;
        }
        $slash = strpos($path, '/');

        return $slash !== false && $slash < strlen($path) - 1 && in_array(substr($path, 0, $slash), self::ROOT_DIRS, true);
    }

    /**
     * Relative, "/"-separated, no "..", ".", empty segment, backslash, control character nor NUL.
     */
    public static function isSafe(string $path): bool
    {
        if ($path === '' || strlen($path) > 255 || str_starts_with($path, '/') || preg_match('//u', $path) !== 1
            || preg_match('/[\x00-\x1F\x7F\\\\:]/', $path) === 1) {
            return false;
        }
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
        }

        return true;
    }

    /**
     * Files of the updater (update.php, app/Domain/Update/**): replaced at the very end of the copy.
     */
    public static function isSelf(string $path): bool
    {
        return $path === 'update.php' || str_starts_with($path, self::SELF_PREFIX);
    }

    /**
     * Copy order: everything else first (sorted), then the updater, the manifest last of all.
     *
     * @param list<string> $paths
     * @return list<string>
     */
    public static function copyOrder(array $paths): array
    {
        $rank = static fn (string $p): int => $p === self::MANIFEST ? 2 : (self::isSelf($p) ? 1 : 0);
        usort($paths, static fn (string $a, string $b): int => [$rank($a), $a] <=> [$rank($b), $b]);

        return $paths;
    }
}
