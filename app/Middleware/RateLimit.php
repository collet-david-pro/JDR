<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\RateLimitedException;
use JDR\Core\RateLimiter;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;
use JDR\Domain\Users\User;

/**
 * Route option rate => login|register|join|pair|upload|forgot|actions (limits: RateLimiter::BUCKETS).
 * "login" only checks the block (failures are counted by AuthService with RateLimiter::hit());
 * the other buckets count every request. 429 rate_limited + Retry-After.
 */
final class RateLimit implements Middleware
{
    /**
     * @param \Closure(): RateLimiter $limiter lazy (needs the database)
     */
    public function __construct(private \Closure $limiter)
    {
    }

    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        $name = $route instanceof RouteMatch ? $route->option('rate') : null;
        if (!is_string($name)) {
            return $next($request);
        }
        $def = RateLimiter::definition($name);
        $limiter = ($this->limiter)();
        $body = $request->parsedBody();
        $body = is_array($body) ? $body : [];
        $ip = $request->ip();
        $user = $request->attribute('user');
        $actor = $user instanceof User ? 'u' . $user->id : 'ip' . $ip;

        if ($name === 'login') {
            $identifier = $body['identifier'] ?? null;
            if (is_string($identifier) && trim($identifier) !== '') {
                $wait = $limiter->tooMany(RateLimiter::key('login', trim($identifier), $ip));
                if ($wait !== null) {
                    throw new RateLimitedException($wait);
                }
            }

            return $next($request);
        }
        $email = $body['email'] ?? null;
        $bucket = match ($name) {
            'forgot' => RateLimiter::key('forgot', is_string($email) ? $email : '', $ip),
            'register', 'pair' => RateLimiter::key($name, $ip),
            'join' => RateLimiter::key('join', $ip, $actor),
            default => RateLimiter::key($name, $actor),
        };
        $wait = $limiter->attempt($bucket, $def['limit'], $def['window']);
        if ($wait !== null) {
            throw new RateLimitedException($wait);
        }

        return $next($request);
    }
}
