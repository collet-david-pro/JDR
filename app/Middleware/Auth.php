<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\UnauthenticatedException;
use JDR\Core\Logger;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;
use JDR\Core\Session\CookieParams;
use JDR\Core\Session\Session;
use JDR\Domain\Auth\Authenticator;
use JDR\Domain\Auth\RememberMe;
use JDR\Domain\Displays\DisplayAuth;

/**
 * Resolves the current user for every API route: attribute "user" = JDR\Domain\Users\User|null
 * (session, else "remember me" cookie; status re-read on every request).
 * Route options: auth=true => 401 without user; role='admin' => 401 without user, 403 for a non-admin;
 * display='only' => the request is always the projection screen (cookie jdr_display; attributes user = null,
 * display = Display; 401 display_unpaired without a valid one); display=true => the screen only when the query
 * carries as=display (else the route behaves as usual, auth applies).
 * session_close=true => the session is written and released right after (SSE, long polling).
 */
final class Auth implements Middleware
{
    /**
     * @param \Closure(): ?Authenticator $authenticator lazy (needs the database; null when not installed)
     */
    public function __construct(
        private \Closure $authenticator,
        private Logger $logger,
        private ?\Closure $displayAuth = null,
    ) {
    }

    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        $session = $request->attribute('session');
        $params = $request->attribute('cookie_params');
        if ($route instanceof RouteMatch && $this->wantsDisplay($route, $request)) {
            $display = $this->displayAuth === null ? null : ($this->displayAuth)()?->resolve($request);
            if ($display === null) {
                throw new UnauthenticatedException('', [], 'display_unpaired');
            }
            $request->setAttribute('user', null);
            $request->setAttribute('display', $display);
            $this->logger->setUserId(null);
            if ($route->option('session_close') === true && $session instanceof Session) {
                $session->close();
            }

            return $next($request);
        }
        $user = null;
        if ($session instanceof Session && $params instanceof CookieParams
            && ($session->hasCookie() || is_string($request->cookies[RememberMe::COOKIE] ?? null))) {
            $user = ($this->authenticator)()?->resolve($request, $session, $params);
        }
        $request->setAttribute('user', $user);
        $this->logger->setUserId($user?->id);

        if ($route instanceof RouteMatch) {
            $role = $route->option('role');
            if (($route->option('auth') === true || $role !== null) && $user === null) {
                throw new UnauthenticatedException();
            }
            if ($role !== null && $user !== null && $user->role !== $role) {
                throw new ForbiddenException();
            }
            if ($route->option('session_close') === true && $session instanceof Session) {
                $session->close();
            }
        }

        return $next($request);
    }

    private function wantsDisplay(RouteMatch $route, Request $request): bool
    {
        $mode = $route->option('display');

        return $mode === 'only' || ($mode === true && ($request->query['as'] ?? null) === 'display');
    }
}
