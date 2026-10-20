<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Errors\MaintenanceException;
use JDR\Core\I18n;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;
use JDR\Core\SystemStatus;

/**
 * 503 + Retry-After when the site is not installed, in maintenance, or its database is behind the code.
 * Routes with option maintenance_exempt (health, version) always pass.
 * TODO(P1): let a logged-in admin through (redirected to update.php by the front-end).
 */
final class Maintenance implements Middleware
{
    public function __construct(
        private ?Config $config,
        private SystemStatus $status,
        private I18n $i18n,
        private string $requiredDbVersion,
    ) {
    }

    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        if ($route instanceof RouteMatch && $route->option('maintenance_exempt') === true) {
            return $next($request);
        }
        if ($this->config === null) {
            throw new MaintenanceException($this->i18n->t('errors.not_installed'));
        }
        if ($this->status->needsMaintenance($this->requiredDbVersion)) {
            throw new MaintenanceException();
        }

        return $next($request);
    }
}
