<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;

/**
 * API middleware. Order (projet.md 6.1): Json, Maintenance, Session, Auth, Csrf, RateLimit, controller.
 */
interface Middleware
{
    /**
     * @param callable(Request): Response $next
     */
    public function process(Request $request, callable $next): Response;
}
