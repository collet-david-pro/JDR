<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Minimal HTTP client used by the installer to probe its own site (injectable for tests).
 */
interface HttpClient
{
    /**
     * GET $url without following redirects. Returns null when no HTTP answer was obtained
     * (network error, timeout, self-requests forbidden by the host...).
     */
    public function get(string $url): ?HttpResult;
}
