<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;
use JDR\Core\Session\Session;

/**
 * Every non-GET request must carry X-CSRF-Token equal to the session token (32 random bytes,
 * given by GET /auth/me), compared with hash_equals(). Routes with csrf=false are exempt.
 * Refusal: 403 csrf_invalid (the client fetches a fresh token from GET /auth/me).
 */
final class Csrf implements Middleware
{
    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        if ($request->isSafeMethod() || ($route instanceof RouteMatch && $route->option('csrf') === false)) {
            return $next($request);
        }
        $session = $request->attribute('session');
        $expected = $session instanceof Session ? $session->get('_csrf') : null;
        $given = $request->header('x-csrf-token');
        if (!is_string($expected) || $expected === '' || !is_string($given) || !hash_equals($expected, $given)) {
            throw new ForbiddenException('', [], 'csrf_invalid');
        }

        return $next($request);
    }
}
