<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;

/**
 * X-CSRF-Token check for non-GET methods (hash_equals with the session token).
 * Skeleton until P1: secure by default, non-GET requests are refused unless the route
 * explicitly opts out with csrf=false (public endpoints protected otherwise).
 */
final class Csrf implements Middleware
{
    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        if ($request->isSafeMethod() || ($route instanceof RouteMatch && $route->option('csrf') === false)) {
            return $next($request);
        }
        // TODO(P1): compare X-CSRF-Token with the session token using hash_equals().
        throw new ForbiddenException('', [], 'forbidden');
    }
}
