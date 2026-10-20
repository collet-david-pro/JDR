<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Step 1: server requirements (projet.md 6.3 and 19). Red = installation impossible.
 */
final class Requirements
{
    public const MIN_PHP = '8.1.0';
    public const REQUIRED_EXTENSIONS = [
        'pdo_mysql', 'mbstring', 'json', 'fileinfo', 'gd', 'zlib', 'openssl', 'ctype', 'session',
    ];
    public const OPTIONAL_EXTENSIONS = ['imagick', 'apcu', 'zip', 'sodium'];
    private const RECOMMENDED_UPLOAD = 10 * 1024 * 1024;

    /** @var \Closure(string): bool */
    private \Closure $extensionLoaded;
    /** @var \Closure(string): (string|false) */
    private \Closure $ini;

    /**
     * @param (\Closure(string): bool)|null $extensionLoaded
     * @param (\Closure(string): (string|false))|null $ini
     */
    public function __construct(
        private Env $env,
        private Probe $probe,
        ?\Closure $extensionLoaded = null,
        ?\Closure $ini = null,
    ) {
        $this->extensionLoaded = $extensionLoaded ?? static fn (string $e): bool => extension_loaded($e);
        $this->ini = $ini ?? static fn (string $k): string|false => ini_get($k);
    }

    /**
     * @return list<Check>
     */
    public function run(): array
    {
        $checks = [$this->php()];
        foreach (self::REQUIRED_EXTENSIONS as $ext) {
            $checks[] = $this->extension($ext, true);
        }
        $checks[] = $this->gdFormats();
        foreach (self::OPTIONAL_EXTENSIONS as $ext) {
            $checks[] = $this->extension($ext, false);
        }
        $checks[] = $this->writable('storage', $this->env->root . '/storage', true);
        $checks[] = $this->writable('root', $this->env->root, false);
        $checks[] = $this->sessionPath();
        $checks[] = $this->probe->routingMode($this->env->baseUrl());
        $checks = array_merge($checks, $this->protection());
        $checks[] = $this->env->isHttps()
            ? new Check('https', Check::OK, 'req.https', 'HTTPS')
            : new Check('https', Check::WARN, 'req.https', 'HTTP', 'req.https.no');
        $checks = array_merge($checks, $this->limits());
        $checks[] = $this->clock();

        return $checks;
    }

    private function php(): Check
    {
        $ok = version_compare(PHP_VERSION, self::MIN_PHP, '>=');

        return new Check('php', $ok ? Check::OK : Check::ERROR, 'req.php', PHP_VERSION, $ok ? null : 'req.php.old');
    }

    private function extension(string $ext, bool $required): Check
    {
        $loaded = ($this->extensionLoaded)($ext);
        $status = $loaded ? Check::OK : ($required ? Check::ERROR : Check::WARN);
        $hint = $loaded ? null : ($required ? 'req.ext.missing' : 'req.ext.optional.' . $ext);

        return new Check('ext_' . $ext, $status, $required ? 'req.ext' : 'req.ext_optional', $ext, $hint);
    }

    private function gdFormats(): Check
    {
        if (!($this->extensionLoaded)('gd') || !function_exists('gd_info')) {
            return new Check('gd_formats', Check::ERROR, 'req.gd_formats', '—', 'req.ext.missing');
        }
        $info = gd_info();
        $missing = [];
        $formats = ['PNG Support' => 'PNG', 'JPEG Support' => 'JPEG', 'WebP Support' => 'WebP', 'GIF Read Support' => 'GIF'];
        foreach ($formats as $k => $f) {
            if (empty($info[$k])) {
                $missing[] = $f;
            }
        }

        return $missing === []
            ? new Check('gd_formats', Check::OK, 'req.gd_formats', 'PNG, JPEG, WebP, GIF')
            : new Check('gd_formats', Check::ERROR, 'req.gd_formats', implode(', ', $missing), 'req.gd_formats.missing');
    }

    private function writable(string $id, string $path, bool $required): Check
    {
        $ok = is_dir($path) && is_writable($path);
        $label = 'req.write_' . $id;

        return Check::when($ok, 'write_' . $id, $label, $ok ? 'OK' : '✗', $label . '.no', $required ? Check::ERROR : Check::WARN);
    }

    private function sessionPath(): Check
    {
        $path = (string) ($this->ini)('session.save_path');
        // "N;/path" syntax: the directory is the last part.
        $dir = $path === '' ? sys_get_temp_dir() : (string) substr($path, (int) strrpos(';' . $path, ';'));
        $ok = $dir !== '' && is_dir($dir) && is_writable($dir);

        return Check::when($ok, 'session_path', 'req.session_path', $ok ? 'OK' : $dir, 'req.session_path.no', Check::WARN);
    }

    /**
     * @return list<Check>
     */
    private function protection(): array
    {
        $base = rtrim($this->env->baseUrl(), '/');
        $checks = [$this->probe->privateFile('protect_app', $base . '/app/canary.txt', 'req.protect_app')];

        // Temporary canary in storage/ (only write allowed before step 5), removed right after.
        $dir = $this->env->root . '/storage';
        $name = 'install-canary-' . bin2hex(random_bytes(6)) . '.txt';
        if (is_dir($dir) && is_writable($dir) && @file_put_contents($dir . '/' . $name, Probe::CANARY_MARKER . "\n") !== false) {
            try {
                $checks[] = $this->probe->privateFile('protect_storage', $base . '/storage/' . $name, 'req.protect_storage');
            } finally {
                @unlink($dir . '/' . $name);
            }
        } else {
            $checks[] = new Check('protect_storage', Check::WARN, 'req.protect_storage', '?', 'req.protect.untested');
        }

        return $checks;
    }

    /**
     * @return list<Check>
     */
    private function limits(): array
    {
        $upload = min(self::bytes(($this->ini)('upload_max_filesize')), self::bytes(($this->ini)('post_max_size')));
        $memory = self::bytes(($this->ini)('memory_limit'));
        $time = (int) ($this->ini)('max_execution_time');
        $buffering = (string) ($this->ini)('output_buffering');
        $compression = (string) ($this->ini)('zlib.output_compression');

        return [
            new Check(
                'upload',
                $upload >= self::RECOMMENDED_UPLOAD ? Check::OK : Check::WARN,
                'req.upload',
                self::human($upload),
                $upload >= self::RECOMMENDED_UPLOAD ? null : 'req.upload.low',
            ),
            new Check(
                'memory',
                $memory < 0 || $memory >= 128 * 1024 * 1024 ? Check::OK : Check::WARN,
                'req.memory',
                $memory < 0 ? '∞' : self::human($memory),
                $memory < 0 || $memory >= 128 * 1024 * 1024 ? null : 'req.memory.low',
            ),
            new Check(
                'time',
                $time === 0 || $time >= 30 ? Check::OK : Check::WARN,
                'req.time',
                $time === 0 ? '∞' : $time . ' s',
                $time === 0 || $time >= 30 ? null : 'req.time.low',
            ),
            new Check(
                'buffering',
                self::isOn($buffering) || self::isOn($compression) ? Check::WARN : Check::OK,
                'req.buffering',
                (self::isOn($buffering) ? 'output_buffering ' : '') . (self::isOn($compression) ? 'zlib' : '') ?: 'off',
                self::isOn($buffering) || self::isOn($compression) ? 'req.buffering.on' : null,
            ),
        ];
    }

    private function clock(): Check
    {
        $year = (int) gmdate('Y');
        $ok = $year >= 2025 && $year < 2100;

        $now = gmdate('Y-m-d H:i:s') . ' UTC';

        return Check::when($ok, 'clock', 'req.clock', $now, 'req.clock.bad', Check::WARN, 'req.clock.db_later');
    }

    private static function isOn(string $value): bool
    {
        $v = strtolower(trim($value));

        return $v !== '' && $v !== '0' && $v !== 'off' && $v !== 'false' && $v !== 'no';
    }

    /**
     * php.ini shorthand ("128M") to bytes; -1 (unlimited) stays -1.
     */
    public static function bytes(string|false $value): int
    {
        $value = trim((string) $value);
        if ($value === '') {
            return 0;
        }
        if ($value === '-1') {
            return -1;
        }
        $unit = strtolower(substr($value, -1));
        $n = (int) $value;

        return match ($unit) {
            'g' => $n * 1024 ** 3,
            'm' => $n * 1024 ** 2,
            'k' => $n * 1024,
            default => $n,
        };
    }

    public static function human(int $bytes): string
    {
        if ($bytes >= 1024 ** 3) {
            return round($bytes / 1024 ** 3, 1) . ' Go';
        }
        if ($bytes >= 1024 ** 2) {
            return round($bytes / 1024 ** 2, 1) . ' Mo';
        }

        return $bytes >= 1024 ? round($bytes / 1024) . ' Ko' : $bytes . ' o';
    }
}
