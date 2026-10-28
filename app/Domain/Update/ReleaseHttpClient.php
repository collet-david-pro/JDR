<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Install\HttpResult;

/**
 * Outgoing HTTPS GET used by the update check (GitHub API and release assets). Injectable for tests.
 */
interface ReleaseHttpClient
{
    /**
     * GET $url (redirects to HTTPS URLs followed). Null when no HTTP answer was obtained
     * (network error, timeout, outgoing connections blocked by the host, body too large).
     *
     * @param array<string, string> $headers
     */
    public function get(string $url, array $headers = []): ?HttpResult;
}
