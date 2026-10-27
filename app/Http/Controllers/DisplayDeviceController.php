<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\UnauthenticatedException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\Session\CookieParams;
use JDR\Domain\Displays\DisplayAuth;
use JDR\Domain\Displays\DisplayDevice;

/**
 * Projection screen, device side (contract P7a "Endpoints écran"). Identity: the jdr_display
 * cookie, resolved by the Auth middleware (route option display => 'only').
 */
final class DisplayDeviceController
{
    public function __construct(private DisplayDevice $device)
    {
    }

    /**
     * POST /display/pair {code} -> 200 {display: DisplayMe} + cookie (422 display_code_invalid)
     */
    public function pair(Request $request): Response
    {
        return Response::ok($this->device->pair($request, self::body($request), self::params($request)));
    }

    /**
     * GET /display/me -> DisplayMe (401 display_unpaired)
     */
    public function show(Request $request): Response
    {
        return Response::ok($this->device->current($request, self::display($request), self::params($request)));
    }

    /**
     * PATCH /display/me {settings} -> DisplayMe
     */
    public function update(Request $request): Response
    {
        return Response::ok($this->device->patch(self::display($request), self::body($request)));
    }

    /**
     * POST /display/unpair -> 204, cookie cleared
     */
    public function unpair(Request $request): Response
    {
        $this->device->unpair(self::display($request), self::params($request));

        return Response::noContent();
    }

    private static function display(Request $request): \JDR\Domain\Displays\Display
    {
        return DisplayAuth::of($request) ?? throw new UnauthenticatedException('', [], 'display_unpaired');
    }

    private static function params(Request $request): CookieParams
    {
        $params = $request->attribute('cookie_params');

        return $params instanceof CookieParams ? $params : new CookieParams('/', false);
    }

    /**
     * @return array<array-key, mixed>
     */
    private static function body(Request $request): array
    {
        $body = $request->parsedBody();

        return is_array($body) ? $body : [];
    }
}
