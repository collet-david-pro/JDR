<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\UnauthenticatedException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;

/**
 * Authentication for routes with option auth=true. Skeleton until P1:
 * secure by default, a protected route is always refused.
 */
final class Auth implements Middleware
{
    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        if ($route instanceof RouteMatch && $route->option('auth') === true) {
            // TODO(P1): resolve the user from the session.
            throw new UnauthenticatedException();
        }

        return $next($request);
    }
}
