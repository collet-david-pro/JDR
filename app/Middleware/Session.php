<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;
use JDR\Core\Session\CookieParams;
use JDR\Core\Session\Session as RequestSession;
use JDR\Core\Session\SessionBackend;
use JDR\Core\Session\SessionOptions;

/**
 * Attaches the request session (attribute "session", JDR\Core\Session\Session) and the cookie
 * parameters (attribute "cookie_params"). The PHP session is started lazily: only when the browser
 * sent jdr_sid or when something is written (CSRF token, login). Written and closed at the end of
 * the request, or earlier with the route option session_close (see Auth).
 * Routes with session=false or maintenance_exempt=true (health, version) get no session at all:
 * no lock, no database access, attribute "user" = null.
 */
final class Session implements Middleware
{
    /**
     * @param \Closure(): int $idleHours settings.session_idle_hours (read on first start only)
     */
    public function __construct(
        private SessionBackend $backend,
        private Clock $clock,
        private \Closure $idleHours,
        private ?Config $config = null,
    ) {
    }

    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        if ($route instanceof RouteMatch
            && ($route->option('session') === false || $route->option('maintenance_exempt') === true)) {
            return $next($request);
        }
        $params = CookieParams::fromRequest($request, $this->config);
        $request->setAttribute('cookie_params', $params);
        $cookie = $request->cookies[SessionOptions::COOKIE_NAME] ?? null;
        $idleHours = $this->idleHours;
        $session = new RequestSession(
            $this->backend,
            static fn (): SessionOptions => new SessionOptions($params->path, $params->secure, max(1, $idleHours()) * 3600),
            is_string($cookie) && $cookie !== '' ? $cookie : null,
            $this->clock->timestamp(),
        );
        $request->setAttribute('session', $session);
        try {
            return $next($request);
        } finally {
            $session->commit();
        }
    }
}
