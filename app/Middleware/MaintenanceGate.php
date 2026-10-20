<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\MaintenanceException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;
use JDR\Domain\Auth\CurrentUser;

/**
 * Second half of the maintenance check (runs after Auth): while the maintenance flag is set,
 * only admins and the login routes (option maintenance_login) are served (projet.md 6.1 step 3).
 */
final class MaintenanceGate implements Middleware
{
    public function process(Request $request, callable $next): Response
    {
        if ($request->attribute('maintenance_flag') !== true) {
            return $next($request);
        }
        $route = $request->attribute('route');
        if ($route instanceof RouteMatch && $route->option('maintenance_login') === true) {
            return $next($request);
        }
        if (CurrentUser::of($request)?->isAdmin() === true) {
            return $next($request);
        }

        throw new MaintenanceException();
    }
}
