<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

final class RouteMatch
{
    /**
     * @param array{0: class-string, 1: string}|\Closure $handler
     * @param array<string, string>                     $params
     * @param array<string, mixed>                      $options
     */
    public function __construct(
        public readonly string $pattern,
        public readonly array|\Closure $handler,
        public readonly array $params,
        public readonly array $options,
    ) {
    }

    public function option(string $name, mixed $default = null): mixed
    {
        return $this->options[$name] ?? $default;
    }
}
