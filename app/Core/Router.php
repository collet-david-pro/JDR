<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\MethodNotAllowedException;
use JDR\Core\Errors\NotFoundException;

/**
 * Path router. Patterns use "{name}" (one path segment) or "{name:regex}".
 * Works on the routed path, so it is identical in "rewrite" and "query" modes
 * (see Request::resolvePath()).
 *
 * Route options (read by middlewares): auth (bool), maintenance_exempt (bool),
 * rate (string|null, rate-limit bucket name), raw_body (bool).
 */
final class Router
{
    /**
     * @var list<array{methods: list<string>, pattern: string, regex: string,
     *     handler: array{0: class-string, 1: string}|\Closure, options: array<string, mixed>}>
     */
    private array $routes = [];

    /**
     * @param string|list<string>                      $methods
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, mixed>                      $options
     */
    public function add(string|array $methods, string $pattern, array|\Closure $handler, array $options = []): void
    {
        $methods = array_values(array_map('strtoupper', (array) $methods));
        $pattern = '/' . trim($pattern, '/');
        $this->routes[] = [
            'methods' => $methods,
            'pattern' => $pattern,
            'regex' => self::compile($pattern),
            'handler' => $handler,
            'options' => $options,
        ];
    }

    /**
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, mixed>                      $options
     */
    public function get(string $pattern, array|\Closure $handler, array $options = []): void
    {
        $this->add('GET', $pattern, $handler, $options);
    }

    /**
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, mixed>                      $options
     */
    public function post(string $pattern, array|\Closure $handler, array $options = []): void
    {
        $this->add('POST', $pattern, $handler, $options);
    }

    /**
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, mixed>                      $options
     */
    public function put(string $pattern, array|\Closure $handler, array $options = []): void
    {
        $this->add('PUT', $pattern, $handler, $options);
    }

    /**
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, mixed>                      $options
     */
    public function patch(string $pattern, array|\Closure $handler, array $options = []): void
    {
        $this->add('PATCH', $pattern, $handler, $options);
    }

    /**
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, mixed>                      $options
     */
    public function delete(string $pattern, array|\Closure $handler, array $options = []): void
    {
        $this->add('DELETE', $pattern, $handler, $options);
    }

    /**
     * @throws NotFoundException         no route for this path
     * @throws MethodNotAllowedException path known, method not allowed
     */
    public function match(string $method, string $path): RouteMatch
    {
        $method = strtoupper($method);
        $path = Request::normalizePath($path);
        $allowed = [];
        foreach ($this->routes as $route) {
            if (preg_match($route['regex'], $path, $m) !== 1) {
                continue;
            }
            $methods = $route['methods'];
            if (in_array('GET', $methods, true) && !in_array('HEAD', $methods, true)) {
                $methods[] = 'HEAD';
            }
            if (!in_array($method, $methods, true)) {
                array_push($allowed, ...$methods);
                continue;
            }
            $params = [];
            foreach ($m as $key => $value) {
                if (is_string($key)) {
                    $params[$key] = $value;
                }
            }

            return new RouteMatch($route['pattern'], $route['handler'], $params, $route['options']);
        }
        if ($allowed !== []) {
            throw new MethodNotAllowedException(array_values(array_unique($allowed)));
        }
        throw new NotFoundException();
    }

    private static function compile(string $pattern): string
    {
        $parts = preg_split(
            '#(\{[a-zA-Z_][a-zA-Z0-9_]*(?::[^{}/]+)?\})#',
            $pattern,
            -1,
            PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY,
        );
        $regex = '';
        foreach ($parts === false ? [] : $parts as $part) {
            if (preg_match('#^\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^{}/]+))?\}$#', $part, $m) === 1) {
                $constraint = isset($m[2]) && $m[2] !== '' ? $m[2] : '[^/]+';
                $regex .= '(?P<' . $m[1] . '>' . $constraint . ')';
            } else {
                $regex .= preg_quote($part, '#');
            }
        }

        return '#^' . $regex . '$#D';
    }
}
