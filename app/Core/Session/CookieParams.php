<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;

/**
 * Path and Secure flag of the application cookies (jdr_sid, jdr_remember):
 * Path = base path (or "/"), Secure when HTTPS or config cookie_secure.
 */
final class CookieParams
{
    public function __construct(public readonly string $path, public readonly bool $secure)
    {
    }

    public static function fromRequest(Request $request, ?Config $config): self
    {
        $secure = ($config?->cookieSecure() ?? false) || $request->isHttps($config?->isHttpsBaseUrl() ?? false);

        return new self($request->basePath === '' ? '/' : $request->basePath, $secure);
    }
}
