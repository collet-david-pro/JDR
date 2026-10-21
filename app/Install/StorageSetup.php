<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * storage/ tree and its protections (projet.md 5.2): .htaccess "deny all" + index.php answering 403.
 * Idempotent: existing files are kept.
 */
final class StorageSetup
{
    public const DIRS = ['assets', 'backups', 'logs', 'tmp', 'cache', 'cache/ch', 'locks', 'jobs'];
    public const LOCK_FILE = 'install.lock';

    public const HTACCESS = <<<'TXT'
# Private folder (projet.md 5.2): deny all, Apache 2.2 and 2.4.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order deny,allow
    Deny from all
</IfModule>

TXT;

    public const INDEX_PHP = <<<'TXT'
<?php

/*
 * Private folder: never served over HTTP. Answers 403 if .htaccess is ignored
 * (no JDR_BOOT guard here on purpose: this file is the guard).
 */

declare(strict_types=1);

http_response_code(403);
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
echo 'Forbidden';

TXT;

    /**
     * Creates the tree. Throws when a folder cannot be created or is not writable.
     */
    public static function create(string $storage): void
    {
        self::mkdir($storage);
        foreach (self::DIRS as $dir) {
            self::mkdir($storage . '/' . $dir);
        }
        self::put($storage . '/.htaccess', self::HTACCESS);
        self::put($storage . '/index.php', self::INDEX_PHP);
    }

    /**
     * Writes storage/install.lock (refuses a second run of install.php).
     */
    public static function writeLock(string $storage, string $version): bool
    {
        $content = json_encode(
            ['installed_at' => gmdate('Y-m-d\TH:i:s\Z'), 'version' => $version],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        ) . "\n";

        return ConfigWriter::writeAtomic($storage . '/' . self::LOCK_FILE, $content, 0640);
    }

    /**
     * Whether $path can hold the storage: existing writable folder, or creatable in a writable parent.
     */
    public static function isUsable(string $path): bool
    {
        if (is_dir($path)) {
            return is_writable($path);
        }
        $parent = dirname($path);

        return $parent !== $path && is_dir($parent) && is_writable($parent);
    }

    /**
     * True when $path lies inside one of $publicRoots (a public folder must not hold a custom storage).
     *
     * @param list<string|null> $publicRoots
     */
    public static function isInside(string $path, array $publicRoots): bool
    {
        $real = realpath($path);
        if ($real === false) {
            $parent = realpath(dirname($path));
            $real = $parent === false ? $path : $parent . '/' . basename($path);
        }
        $real = rtrim(str_replace('\\', '/', $real), '/') . '/';
        foreach ($publicRoots as $root) {
            if ($root === null || $root === '') {
                continue;
            }
            $r = rtrim(str_replace('\\', '/', $root), '/') . '/';
            if (str_starts_with($real, $r)) {
                return true;
            }
        }

        return false;
    }

    private static function mkdir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create folder ' . $dir);
        }
        if (!is_writable($dir)) {
            throw new \RuntimeException('Folder not writable: ' . $dir);
        }
    }

    private static function put(string $file, string $content): void
    {
        if (!is_file($file) && @file_put_contents($file, $content) === false) {
            throw new \RuntimeException('Cannot write ' . $file);
        }
    }
}
