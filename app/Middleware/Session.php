<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;

/**
 * PHP session (jdr_sid, strict mode, HttpOnly, SameSite=Lax). Skeleton: implemented in P1.
 */
final class Session implements Middleware
{
    public function process(Request $request, callable $next): Response
    {
        return $next($request);
    }
}
