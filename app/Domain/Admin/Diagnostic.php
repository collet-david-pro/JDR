<?php

declare(strict_types=1);

namespace JDR\Domain\Admin;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Db;
use JDR\Core\Request;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Support\AppPaths;

/**
 * Admin diagnostic page (projet.md 6.6): list of checks {id, status ok|warn|error, value, hint_key}.
 * Labels: i18n diagnostic.checks.<id>; hints: diagnostic.hints.<id>.
 */
final class Diagnostic
{
    private const REQUIRED_EXT = ['pdo_mysql', 'mbstring', 'json', 'fileinfo', 'gd', 'zlib', 'openssl', 'ctype', 'session'];
    private const OPTIONAL_EXT = ['imagick', 'apcu', 'zip', 'sodium'];
    /** Manifest entries that may legitimately be absent (deleted installer, private storage). */
    private const OPTIONAL_FILES = ['install.php'];

    public function __construct(
        private Db $db,
        private Settings $settings,
        private AppPaths $paths,
        private HttpProbe $probe,
        private ?Config $config = null,
    ) {
    }

    /**
     * @return list<array{id: string, status: string, value: mixed, hint_key: string|null}>
     */
    public function run(Request $request): array
    {
        $checks = [];
        $add = static function (string $id, string $status, mixed $value) use (&$checks): void {
            $checks[] = [
                'id' => $id,
                'status' => $status,
                'value' => $value,
                'hint_key' => $status === 'ok' ? null : 'diagnostic.hints.' . $id,
            ];
        };

        $add('php_version', version_compare(PHP_VERSION, '8.1.0', '>=') ? 'ok' : 'error', PHP_VERSION);
        $mysql = $this->safe(fn (): string => $this->db->serverVersion());
        $add('mysql_version', $mysql === null ? 'error' : (self::mysqlSupported($mysql) ? 'ok' : 'warn'), $mysql);
        $add('app_version', 'ok', \APP_VERSION);
        $dbVersion = $this->settings->get('db_version');
        $dbVersion = is_string($dbVersion) ? $dbVersion : null;
        $add(
            'db_version',
            $dbVersion !== null && (int) $dbVersion >= (int) \REQUIRED_DB_VERSION ? 'ok' : 'error',
            ['current' => $dbVersion, 'required' => \REQUIRED_DB_VERSION],
        );
        foreach (self::REQUIRED_EXT as $ext) {
            $add('ext_' . $ext, extension_loaded($ext) ? 'ok' : 'error', extension_loaded($ext));
        }
        foreach (self::OPTIONAL_EXT as $ext) {
            $add('ext_' . $ext, extension_loaded($ext) ? 'ok' : 'warn', extension_loaded($ext));
        }
        $add(...$this->gdFormats());

        $maxUpload = $this->settings->int('max_upload_bytes');
        foreach (['upload_max_filesize', 'post_max_size'] as $ini) {
            $bytes = self::iniBytes((string) ini_get($ini));
            $add($ini, $bytes >= $maxUpload || $bytes <= 0 ? 'ok' : 'warn', (string) ini_get($ini));
        }
        $memory = self::iniBytes((string) ini_get('memory_limit'));
        $add('memory_limit', $memory <= 0 || $memory >= 128 * 1048576 ? 'ok' : 'warn', (string) ini_get('memory_limit'));
        $exec = (int) ini_get('max_execution_time');
        $add('max_execution_time', $exec === 0 || $exec >= 30 ? 'ok' : 'warn', $exec);
        $ob = (string) ini_get('output_buffering');
        $add('output_buffering', $ob === '' || $ob === '0' || strtolower($ob) === 'off' ? 'ok' : 'warn', $ob);
        $zlib = (bool) ini_get('zlib.output_compression');
        $add('zlib_output_compression', $zlib ? 'warn' : 'ok', $zlib);
        $add(...$this->sessionSavePath());
        $add('routing_mode', 'ok', $this->config?->routingMode() ?? Config::ROUTING_REWRITE);
        $https = $request->isHttps($this->config?->isHttpsBaseUrl() ?? false);
        $add('https', $https ? 'ok' : 'warn', $https);
        $add(...$this->storageWritable());
        $add(...$this->privateDirs());
        $add(...$this->clock());
        $free = @disk_free_space($this->paths->storage);
        $add(
            'disk_free',
            $free === false ? 'warn' : ($free < 50 * 1048576 ? 'error' : ($free < 500 * 1048576 ? 'warn' : 'ok')),
            $free === false ? null : (int) $free,
        );
        $size = $this->safe(fn (): int => (int) $this->db->fetchValue(
            'SELECT COALESCE(SUM(`data_length` + `index_length`), 0) FROM information_schema.TABLES '
            . 'WHERE `table_schema` = DATABASE() AND `table_name` LIKE ?',
            [addcslashes($this->db->prefix(), '\\_%') . '%'],
        ));
        $add('db_size', $size === null ? 'warn' : 'ok', $size);
        $assets = $this->safe(fn (): int => (int) $this->db->fetchValue(
            'SELECT COUNT(*) FROM ' . $this->db->t('assets') . ' WHERE `deleted_at` IS NULL',
        ));
        $add('asset_files', $assets === null ? 'warn' : 'ok', $assets);
        $add(...$this->integrity());

        return $checks;
    }

    /**
     * @return array{0: string, 1: string, 2: mixed}
     */
    private function gdFormats(): array
    {
        if (!function_exists('gd_info')) {
            return ['gd_formats', 'error', null];
        }
        $info = gd_info();
        $formats = [
            'png' => (bool) ($info['PNG Support'] ?? false),
            'jpeg' => (bool) ($info['JPEG Support'] ?? false),
            'webp' => (bool) ($info['WebP Support'] ?? false),
            'gif' => (bool) ($info['GIF Read Support'] ?? false) && (bool) ($info['GIF Create Support'] ?? false),
        ];

        return ['gd_formats', in_array(false, $formats, true) ? 'error' : 'ok', $formats];
    }

    /**
     * @return array{0: string, 1: string, 2: mixed}
     */
    private function sessionSavePath(): array
    {
        if ($this->settings->bool('use_db_sessions')) {
            return ['session_save_path', 'ok', 'database'];
        }
        $path = (string) ini_get('session.save_path');
        $dir = $path === '' ? sys_get_temp_dir() : (string) preg_replace('/^.*;/', '', $path);

        return ['session_save_path', is_dir($dir) && is_writable($dir) ? 'ok' : 'error', $path === '' ? $dir : $path];
    }

    /**
     * @return array{0: string, 1: string, 2: mixed}
     */
    private function storageWritable(): array
    {
        $file = $this->paths->storage . '/tmp/diag-' . bin2hex(random_bytes(6)) . '.txt';
        $ok = @file_put_contents($file, 'ok') === 2;
        @unlink($file);

        return ['storage_writable', $ok ? 'ok' : 'error', $ok];
    }

    /**
     * Requests private files over HTTP: every answer must be 403/404.
     *
     * @return array{0: string, 1: string, 2: mixed}
     */
    private function privateDirs(): array
    {
        $base = $this->config?->baseUrl() ?? '';
        if ($base === '') {
            return ['private_dirs', 'warn', null];
        }
        $targets = [
            is_file($this->paths->publicRoot . '/app/canary.txt') ? '/app/canary.txt' : '/app/.htaccess',
            '/migrations/0001_initial.sql',
            '/i18n/fr.json',
        ];
        // Storage inside the web root: a temporary canary file must not be served.
        $root = realpath($this->paths->publicRoot);
        $storage = realpath($this->paths->storage);
        $canaryFile = null;
        if ($root !== false && $storage !== false && str_starts_with($storage . '/', $root . '/')) {
            $name = 'diag-canary-' . bin2hex(random_bytes(6)) . '.txt';
            if (@file_put_contents($storage . '/tmp/' . $name, 'canary') !== false) {
                $canaryFile = $storage . '/tmp/' . $name;
                $targets[] = substr($storage, strlen($root)) . '/tmp/' . $name;
            }
        }
        $results = [];
        $status = 'ok';
        try {
            foreach ($targets as $target) {
                $code = $this->probe->status($base . $target);
                $results[$target] = $code;
                if ($code === null) {
                    $status = 'warn';
                    break;
                }
                if ($code >= 200 && $code < 300) {
                    $status = 'error';
                }
            }
        } finally {
            if ($canaryFile !== null) {
                @unlink($canaryFile);
            }
        }

        return ['private_dirs', $status, $results];
    }

    /**
     * @return array{0: string, 1: string, 2: mixed}
     */
    private function clock(): array
    {
        $db = $this->safe(fn (): int => (int) $this->db->fetchValue('SELECT UNIX_TIMESTAMP()'));
        if ($db === null) {
            return ['clock_skew', 'warn', null];
        }
        $skew = abs(time() - $db);

        return ['clock_skew', $skew > 60 ? 'error' : ($skew > 5 ? 'warn' : 'ok'), $skew];
    }

    /**
     * Compares the files with manifest.json (SHA-256); install.php and storage/** are optional.
     *
     * @return array{0: string, 1: string, 2: mixed}
     */
    private function integrity(): array
    {
        $root = $this->paths->publicRoot;
        $json = is_file($root . '/manifest.json') ? file_get_contents($root . '/manifest.json') : false;
        $manifest = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($manifest) || !is_array($manifest['files'] ?? null)) {
            return ['integrity', 'warn', null];
        }
        $modified = [];
        $missing = [];
        $count = 0;
        foreach ($manifest['files'] as $path => $hash) {
            $path = (string) $path;
            if (str_contains($path, '..') || !is_string($hash)) {
                continue;
            }
            $count++;
            $file = $root . '/' . $path;
            if (!is_file($file)) {
                if (!in_array($path, self::OPTIONAL_FILES, true) && !str_starts_with($path, 'storage/')) {
                    $missing[] = $path;
                }
                continue;
            }
            if (str_starts_with($path, 'storage/')) {
                continue;
            }
            if (!hash_equals(strtolower($hash), (string) hash_file('sha256', $file))) {
                $modified[] = $path;
            }
        }
        $status = $modified === [] && $missing === [] ? 'ok' : 'error';

        return ['integrity', $status, [
            'version' => $manifest['version'] ?? null,
            'files' => $count,
            'modified' => array_slice($modified, 0, 50),
            'missing' => array_slice($missing, 0, 50),
        ]];
    }

    private static function mysqlSupported(string $version): bool
    {
        if (preg_match('/^(\d+\.\d+(?:\.\d+)?)/', $version, $m) !== 1) {
            return false;
        }

        return stripos($version, 'mariadb') !== false
            ? version_compare($m[1], '10.3', '>=')
            : version_compare($m[1], '5.7', '>=');
    }

    public static function iniBytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return -1;
        }
        $unit = strtolower(substr($value, -1));
        $number = (int) $value;

        return match ($unit) {
            'g' => $number * 1073741824,
            'm' => $number * 1048576,
            'k' => $number * 1024,
            default => $number,
        };
    }

    /**
     * @template T
     * @param \Closure(): T $fn
     * @return T|null
     */
    private function safe(\Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (\Throwable) {
            return null;
        }
    }
}
