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
 * When only the maintenance flag is set (schema up to date), the request continues with the
 * attribute "maintenance_flag" and MaintenanceGate lets admins (and the login routes) through.
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
            if (!$this->status->maintenanceFlagOnly($this->requiredDbVersion)) {
                throw new MaintenanceException();
            }
            $request->setAttribute('maintenance_flag', true);
        }

        return $next($request);
    }
}
