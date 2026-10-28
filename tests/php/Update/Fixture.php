<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Db;
use JDR\Migrate\MigrationFile;
use JDR\Zip\ZipWriter;

/**
 * Throw-away installations and update archives for the update tests.
 */
final class Fixture
{
    /**
     * Files of the "installed" release 0.1.0 (besides migrations/ and manifest.json).
     *
     * @return array<string, string>
     */
    public static function oldFiles(): array
    {
        return [
            'index.php' => "<?php // front controller v1\n",
            'update.php' => "<?php // updater v1\n",
            'VERSION' => "0.1.0\n",
            'app/Keep.php' => "<?php // unchanged\n",
            'app/Changed.php' => "<?php // version 1\n",
            'app/Old/Gone.php' => "<?php // removed in 0.2.0\n",
            'app/Domain/Update/Probe.php' => "<?php // updater class v1\n",
            'i18n/fr.json' => "{\"a\":\"b\"}\n",
        ];
    }

    /**
     * Files of the release 0.2.0 (besides migrations/ and manifest.json).
     *
     * @return array<string, string>
     */
    public static function newFiles(): array
    {
        $files = self::oldFiles();
        unset($files['app/Old/Gone.php']);

        return [
            'index.php' => "<?php // front controller v2\n",
            'update.php' => "<?php // updater v2\n",
            'VERSION' => "0.2.0\n",
            'app/Changed.php' => "<?php // version 2\n",
            'app/New/Added.php' => "<?php // added in 0.2.0\n",
            'app/Domain/Update/Probe.php' => "<?php // updater class v2\n",
        ] + $files;
    }

    /**
     * The four real migrations (their checksums are those recorded in the test database).
     *
     * @return array<string, string>
     */
    public static function realMigrations(): array
    {
        $out = [];
        foreach (glob(\JDR_ROOT . '/migrations/00*') ?: [] as $file) {
            $out['migrations/' . basename($file)] = (string) file_get_contents($file);
        }

        return $out;
    }

    /**
     * Creates an installation root (files + manifest.json + storage/).
     *
     * @param array<string, string> $files
     */
    public static function install(array $files, string $version = '0.1.0'): string
    {
        $root = sys_get_temp_dir() . '/jdr-upd-' . bin2hex(random_bytes(6));
        mkdir($root . '/storage', 0755, true);
        foreach ($files as $path => $content) {
            @mkdir(dirname($root . '/' . $path), 0755, true);
            file_put_contents($root . '/' . $path, $content);
        }
        file_put_contents($root . '/manifest.json', self::manifest($files, $version));

        return $root;
    }

    /**
     * @param array<string, string> $files
     */
    public static function manifest(array $files, string $version): string
    {
        $hashes = [];
        foreach ($files as $path => $content) {
            $hashes[$path] = hash('sha256', $content);
        }
        ksort($hashes);

        return json_encode(['version' => $version, 'generated_at' => '2026-10-28T00:00:00Z', 'files' => $hashes],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    }

    /**
     * Builds an update archive: $files + manifest.json (from $manifestFiles, default $files) under $prefix.
     *
     * @param array<string, string>      $files
     * @param array<string, string>|null $manifestFiles
     */
    public static function zip(string $dir, array $files, string $version, ?array $manifestFiles = null, string $prefix = '', bool $withManifest = true): string
    {
        $path = $dir . '/pkg-' . bin2hex(random_bytes(4)) . '.zip';
        $zip = ZipWriter::create($path);
        foreach ($files as $name => $content) {
            $zip->addString($prefix . $name, $content);
        }
        if ($withManifest) {
            $zip->addString($prefix . 'manifest.json', self::manifest($manifestFiles ?? $files, $version));
        }
        $zip->finish();

        return $path;
    }

    /**
     * Renames an entry in place (same length): lets tests forge names ZipWriter refuses ("../x", "/abs").
     */
    public static function renameEntry(string $zipPath, string $from, string $to): void
    {
        if (strlen($from) !== strlen($to)) {
            throw new \InvalidArgumentException('Same length required.');
        }
        $data = (string) file_get_contents($zipPath);
        file_put_contents($zipPath, str_replace($from, $to, $data));
    }

    /**
     * Marks an entry as a symbolic link in the central directory (Unix "made by", S_IFLNK mode).
     */
    public static function markSymlink(string $zipPath, string $name): void
    {
        $data = (string) file_get_contents($zipPath);
        $pos = 0;
        while (($pos = strpos($data, "PK\x01\x02", $pos)) !== false) {
            $nameLength = unpack('v', substr($data, $pos + 28, 2))[1];
            if (substr($data, $pos + 46, $nameLength) === $name) {
                $data[$pos + 5] = chr(3);
                $data = substr_replace($data, pack('V', 0xA1FF << 16), $pos + 38, 4);
                break;
            }
            $pos += 4;
        }
        file_put_contents($zipPath, $data);
    }

    /**
     * Every file under $root except storage/ => sha256 (state of an installation).
     *
     * @return array<string, string>
     */
    public static function snapshot(string $root): array
    {
        $out = [];
        $items = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($items as $item) {
            $rel = substr($item->getPathname(), strlen($root) + 1);
            if ($item->isFile() && !str_starts_with($rel, 'storage/')) {
                $out[$rel] = (string) hash_file('sha256', $item->getPathname());
            }
        }
        ksort($out);

        return $out;
    }

    /**
     * Records the real migrations 0002+ as applied (the API test schema only runs 0001).
     */
    public static function markRealMigrationsApplied(Db $db): void
    {
        foreach (glob(\JDR_ROOT . '/migrations/00*') ?: [] as $path) {
            $file = MigrationFile::fromPath($path);
            if ($file === null) {
                continue;
            }
            $db->execute('INSERT IGNORE INTO ' . $db->t('schema_migrations')
                . " (`version`, `name`, `checksum`, `status`, `error`, `applied_at`, `duration_ms`) VALUES (?, ?, ?, 'applied', NULL, UTC_TIMESTAMP(), 0)",
                [$file->version, $file->name, $file->checksum()]);
        }
    }

    public static function remove(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            $item->isDir() && !$item->isLink() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($dir);
    }
}
