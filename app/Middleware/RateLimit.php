<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;

/**
 * Sliding-window rate limiting (table rate_limits) for routes with option rate=<bucket>.
 * Skeleton: implemented in P1.
 */
final class RateLimit implements Middleware
{
    public function process(Request $request, callable $next): Response
    {
        return $next($request);
    }
}
