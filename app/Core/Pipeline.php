<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

use JDR\Middleware\Middleware;

/**
 * Runs middlewares in order, then the core handler.
 */
final class Pipeline
{
    /**
     * @param list<Middleware> $middlewares
     */
    public function __construct(private array $middlewares)
    {
    }

    /**
     * @param callable(Request): Response $core
     */
    public function handle(Request $request, callable $core): Response
    {
        $next = $core;
        foreach (array_reverse($this->middlewares) as $middleware) {
            $next = static fn (Request $r): Response => $middleware->process($r, $next);
        }

        return $next($request);
    }
}
