<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Helpers for the PHP built-in server ("php -S host:port index.php"), which ignores .htaccess.
 */
final class DevServer
{
    /**
     * True when the built-in server should serve the file itself (index.php returns false).
     * Private paths and index.php itself always go through the application.
     */
    public static function shouldServeStatic(string $root, string $requestUri): bool
    {
        $path = rawurldecode(Request::uriPath($requestUri));
        if (PathGuard::isPrivate($path)) {
            return false;
        }
        $normalized = Request::normalizePath($path);
        if ($normalized === '/' || $normalized === '/index.php') {
            return false;
        }
        $file = $root . $normalized;
        if (!is_file($file)) {
            return false;
        }
        $realRoot = realpath($root);
        $realFile = realpath($file);

        return $realRoot !== false && $realFile !== false
            && str_starts_with($realFile, rtrim($realRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR);
    }
}
