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

/**
 * Resolves the current user for every API route: attribute "user" = JDR\Domain\Users\User|null
 * (session, else "remember me" cookie; status re-read on every request).
 * Route options: auth=true => 401 without user; role='admin' => 401 without user, 403 for a non-admin;
 * session_close=true => the session is written and released right after (SSE, long polling).
 */
final class Auth implements Middleware
{
    /**
     * @param \Closure(): ?Authenticator $authenticator lazy (needs the database; null when not installed)
     */
    public function __construct(private \Closure $authenticator, private Logger $logger)
    {
    }

    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        $session = $request->attribute('session');
        $params = $request->attribute('cookie_params');
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
}
