<?php

declare(strict_types=1);

namespace JDR\Domain\Support;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Domain\Settings\Settings;

/**
 * Absolute URLs of SPA pages sent outside the app (e-mails, admin-generated links):
 * base URL = settings.base_url, else config base_url; "query" routing mode uses hash routes.
 * Front-end routes used: /invite/{code}, /reset-password/{token}.
 */
final class Links
{
    public function __construct(private Settings $settings, private ?Config $config = null)
    {
    }

    /**
     * Returns the public base URL, from settings or configuration, without trailing slash.
     */
    public function base(): string
    {
        $base = rtrim($this->settings->string('base_url'), '/');

        return $base !== '' ? $base : ($this->config?->baseUrl() ?? '');
    }

    /**
     * Builds the absolute URL of an application page, honouring the routing mode.
     */
    public function page(string $path): string
    {
        $query = $this->config?->routingMode() === Config::ROUTING_QUERY;

        return $this->base() . ($query ? '/#' : '') . $path;
    }

    /**
     * Builds the absolute registration link for an invitation code.
     */
    public function invitation(string $code): string
    {
        return $this->page('/invite/' . rawurlencode($code));
    }

    /**
     * Builds the absolute password reset link for a token.
     */
    public function passwordReset(string $token): string
    {
        return $this->page('/reset-password/' . rawurlencode($token));
    }
}
