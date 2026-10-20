<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\UnauthenticatedException;
use JDR\Core\Request;
use JDR\Core\Session\Session;
use JDR\Domain\Users\User;

/**
 * Accessors of the request attributes set by the Session and Auth middlewares.
 */
final class CurrentUser
{
    public static function of(Request $request): ?User
    {
        $user = $request->attribute('user');

        return $user instanceof User ? $user : null;
    }

    /**
     * @throws UnauthenticatedException
     */
    public static function require(Request $request): User
    {
        return self::of($request) ?? throw new UnauthenticatedException();
    }

    public static function session(Request $request): Session
    {
        $session = $request->attribute('session');
        if (!$session instanceof Session) {
            throw new \LogicException('No session on this request (Session middleware missing).');
        }

        return $session;
    }
}
