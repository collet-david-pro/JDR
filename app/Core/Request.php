<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\PayloadTooLargeException;

/**
 * HTTP request. The routed path is independent of the routing mode:
 * "/api/v1/health" (rewrite) and "/index.php?r=/api/v1/health" (query) both give "/api/v1/health".
 */
final class Request
{
    /** @var array<string, mixed> */
    private array $attributes = [];

    /** @var array<string, string> */
    private array $params = [];

    private mixed $parsedBody = null;

    private ?string $body;

    /** @var (\Closure(int): string)|null */
    private ?\Closure $bodyReader;

    /**
     * @param array<string, mixed>  $query   query string parameters (without "r")
     * @param array<string, string> $headers lower-cased header names
     * @param array<string, mixed>  $server
     * @param array<string, mixed>  $cookies
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $headers,
        public readonly array $server,
        public readonly string $basePath,
        public readonly string $id,
        public readonly array $cookies = [],
        ?string $body = '',
        ?\Closure $bodyReader = null,
    ) {
        $this->body = $body;
        $this->bodyReader = $bodyReader;
    }

    public static function fromGlobals(?Config $config): self
    {
        /** @var array<string, mixed> $server */
        $server = $_SERVER;
        $uri = (string) ($server['REQUEST_URI'] ?? '/');
        $basePath = self::resolveBasePath($config, $server, $uri);
        $get = $_GET;
        $query = $get;
        unset($query['r']);

        return new self(
            strtoupper((string) ($server['REQUEST_METHOD'] ?? 'GET')),
            self::resolvePath($uri, $basePath, $get),
            $query,
            self::headersFromServer($server),
            $server,
            $basePath,
            self::newId(),
            $_COOKIE,
            null,
            static function (int $limit): string {
                $data = file_get_contents('php://input', false, null, 0, $limit);

                return $data === false ? '' : $data;
            },
        );
    }

    /**
     * Builds a request (tests, internal calls).
     *
     * @param array<string, string> $headers
     * @param array<string, mixed>  $server
     * @param array<string, mixed>  $cookies
     */
    public static function create(
        string $method,
        string $uri,
        array $headers = [],
        string $body = '',
        string $basePath = '',
        array $server = [],
        array $cookies = [],
    ): self {
        $queryString = (string) parse_url($uri, PHP_URL_QUERY);
        parse_str($queryString, $get);
        $query = $get;
        unset($query['r']);
        $normalized = [];
        foreach ($headers as $name => $value) {
            $normalized[strtolower($name)] = $value;
        }
        $server += ['REQUEST_METHOD' => strtoupper($method), 'REQUEST_URI' => $uri, 'REMOTE_ADDR' => '127.0.0.1'];

        return new self(
            strtoupper($method),
            self::resolvePath($uri, $basePath, $get),
            $query,
            $normalized,
            $server,
            Config::normalizeBasePath($basePath),
            self::newId(),
            $cookies,
            $body,
        );
    }

    /**
     * Base path: from base_url when the request URI lives under it, else from SCRIPT_NAME.
     *
     * @param array<string, mixed> $server
     */
    public static function resolveBasePath(?Config $config, array $server, string $uri): string
    {
        $uriPath = self::normalizePath(self::uriPath($uri));
        if ($config !== null && $config->baseUrl() !== '') {
            $base = $config->basePath();
            if ($base === '' || $uriPath === $base || str_starts_with($uriPath, $base . '/')) {
                return $base;
            }
        }
        $script = str_replace('\\', '/', (string) ($server['SCRIPT_NAME'] ?? '/index.php'));

        return Config::normalizeBasePath(dirname($script));
    }

    /**
     * @param array<string, mixed> $get
     */
    public static function resolvePath(string $uri, string $basePath, array $get): string
    {
        $path = self::normalizePath(rawurldecode(self::uriPath($uri)));
        $basePath = Config::normalizeBasePath($basePath);
        if ($basePath !== '' && ($path === $basePath || str_starts_with($path, $basePath . '/'))) {
            $path = self::normalizePath(substr($path, strlen($basePath)));
        }
        if ($path === '/index.php' || str_starts_with($path, '/index.php/')) {
            $path = self::normalizePath(substr($path, strlen('/index.php')));
        }
        $route = $get['r'] ?? null;
        if ($path === '/' && is_string($route) && $route !== '') {
            $path = self::normalizePath($route);
        }

        return $path;
    }

    /**
     * Path part of a request URI ("//games" is a path here, not a network-path reference).
     */
    public static function uriPath(string $uri): string
    {
        if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $uri) === 1) {
            $path = parse_url($uri, PHP_URL_PATH);

            return is_string($path) ? $path : '/';
        }

        return explode('#', explode('?', $uri, 2)[0], 2)[0];
    }

    public static function normalizePath(string $path): string
    {
        $path = '/' . ltrim((string) preg_replace('#/+#', '/', str_replace('\\', '/', $path)), '/');

        return $path === '/' ? '/' : rtrim($path, '/');
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(8));
    }

    /**
     * @param array<string, mixed> $server
     * @return array<string, string>
     */
    private static function headersFromServer(array $server): array
    {
        $headers = [];
        foreach ($server as $key => $value) {
            if (!is_string($value)) {
                continue;
            }
            if (str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            } elseif ($key === 'CONTENT_TYPE' || $key === 'CONTENT_LENGTH') {
                $headers[strtolower(str_replace('_', '-', $key))] = $value;
            }
        }

        return $headers;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function isApi(): bool
    {
        return $this->path === '/api' || str_starts_with($this->path, '/api/');
    }

    public function isSafeMethod(): bool
    {
        return in_array($this->method, ['GET', 'HEAD', 'OPTIONS'], true);
    }

    public function isHttps(bool $trustForwardedProto = false): bool
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

        return $trustForwardedProto && strtolower((string) $this->header('x-forwarded-proto')) === 'https';
    }

    public function ip(): string
    {
        return (string) ($this->server['REMOTE_ADDR'] ?? '');
    }

    /**
     * Raw body, at most $limit bytes.
     *
     * @throws PayloadTooLargeException
     */
    public function rawBody(int $limit = 1048576): string
    {
        if ($this->body === null) {
            $this->body = $this->bodyReader !== null ? ($this->bodyReader)($limit + 1) : '';
        }
        if (strlen($this->body) > $limit) {
            throw new PayloadTooLargeException();
        }

        return $this->body;
    }

    public function setParsedBody(mixed $data): void
    {
        $this->parsedBody = $data;
    }

    public function parsedBody(): mixed
    {
        return $this->parsedBody;
    }

    /**
     * @param array<string, string> $params
     */
    public function setParams(array $params): void
    {
        $this->params = $params;
    }

    public function param(string $name): ?string
    {
        return $this->params[$name] ?? null;
    }

    /**
     * @return array<string, string>
     */
    public function params(): array
    {
        return $this->params;
    }

    public function setAttribute(string $name, mixed $value): void
    {
        $this->attributes[$name] = $value;
    }

    public function attribute(string $name, mixed $default = null): mixed
    {
        return $this->attributes[$name] ?? $default;
    }
}
