<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;

/**
 * What the installer knows about the current request and the deployed files.
 */
final class Env
{
    /**
     * @param array<string, mixed> $server
     */
    public function __construct(public readonly string $root, private array $server)
    {
    }

    public static function fromGlobals(string $root): self
    {
        /** @var array<string, mixed> $server */
        $server = $_SERVER;

        return new self($root, $server);
    }

    public function isHttps(): bool
    {
        $https = strtolower((string) ($this->server['HTTPS'] ?? ''));
        if ($https !== '' && $https !== 'off') {
            return true;
        }
        if ((string) ($this->server['SERVER_PORT'] ?? '') === '443') {
            return true;
        }
        if (strtolower((string) ($this->server['REQUEST_SCHEME'] ?? '')) === 'https') {
            return true;
        }

        // Shared hosts often terminate TLS on a front proxy.
        return strtolower((string) ($this->server['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    }

    /**
     * Host[:port] of the request, or 'localhost' when it is missing or malformed.
     */
    public function host(): string
    {
        $host = strtolower((string) ($this->server['HTTP_HOST'] ?? ($this->server['SERVER_NAME'] ?? '')));
        if (preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*'
            . '|\[[0-9a-f:.]+\])(?::\d{1,5})?$/', $host) !== 1) {
            return 'localhost';
        }

        return $host;
    }

    /**
     * Folder of install.php as seen from the browser ('' at the web root, '/jdr' in a sub-folder).
     */
    public function basePath(): string
    {
        $script = str_replace('\\', '/', (string) ($this->server['SCRIPT_NAME'] ?? '/install.php'));

        return Config::normalizeBasePath(dirname($script));
    }

    public function baseUrl(): string
    {
        return ($this->isHttps() ? 'https' : 'http') . '://' . $this->host() . $this->basePath();
    }

    public function method(): string
    {
        return strtoupper((string) ($this->server['REQUEST_METHOD'] ?? 'GET'));
    }

    public function documentRoot(): ?string
    {
        $docRoot = (string) ($this->server['DOCUMENT_ROOT'] ?? '');
        $real = $docRoot !== '' ? realpath($docRoot) : false;

        return $real === false ? null : $real;
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        $value = $this->server[$key] ?? null;

        return is_string($value) ? $value : null;
    }

    /**
     * Version of the deployed code (VERSION file), '0.0.0' when unreadable.
     */
    public function appVersion(): string
    {
        if (defined('APP_VERSION')) {
            return (string) \APP_VERSION;
        }
        $version = is_file($this->root . '/VERSION') ? trim((string) file_get_contents($this->root . '/VERSION')) : '';

        return preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/', $version) === 1 ? $version : '0.0.0';
    }
}
