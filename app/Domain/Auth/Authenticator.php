<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Session\CookieParams;
use JDR\Core\Session\Session;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserRepository;

/**
 * Resolves the current user of a request: from the session (status re-read on every request),
 * else from the "remember me" cookie. Owns the authentication keys of the session.
 */
final class Authenticator
{
    public const KEY_USER = 'uid';
    public const KEY_FINGERPRINT = '_fp';
    public const KEY_ROLE = '_role';
    public const KEY_REMEMBER = '_rid';

    public function __construct(private UserRepository $users, private RememberMe $remember)
    {
    }

    public function resolve(Request $request, Session $session, CookieParams $cookies): ?User
    {
        $uid = $session->get(self::KEY_USER);
        if (is_int($uid)) {
            $user = $this->users->find($uid);
            if ($user === null || !$user->isActive()
                || !hash_equals($user->sessionFingerprint(), (string) $session->get(self::KEY_FINGERPRINT, ''))) {
                // Suspended, deleted, or password changed elsewhere: this session is over.
                $session->destroy();

                return null;
            }
            if ($session->get(self::KEY_ROLE) !== $user->role) {
                $session->regenerate();
                $session->set(self::KEY_ROLE, $user->role);
            }

            return $user;
        }
        if ($this->remember->hasCookie($request)) {
            $result = $this->remember->consume($request, $cookies);
            if ($result !== null) {
                [$user, $tokenId] = $result;
                $this->login($session, $user, $tokenId);

                return $user;
            }
        }

        return null;
    }

    /**
     * Binds the session to the user (new session id, new CSRF token). Returns the CSRF token.
     */
    public function login(Session $session, User $user, ?int $rememberId): string
    {
        $session->regenerate();
        $session->set(self::KEY_USER, $user->id);
        $session->set(self::KEY_FINGERPRINT, $user->sessionFingerprint());
        $session->set(self::KEY_ROLE, $user->role);
        if ($rememberId === null) {
            $session->remove(self::KEY_REMEMBER);
        } else {
            $session->set(self::KEY_REMEMBER, $rememberId);
        }

        return $session->rotateCsrfToken();
    }

    /**
     * Keeps the current session valid after its own password change.
     */
    public function refreshFingerprint(Session $session, User $user): void
    {
        $session->set(self::KEY_FINGERPRINT, $user->sessionFingerprint());
    }

    public function rememberTokenId(Session $session): ?int
    {
        $rid = $session->get(self::KEY_REMEMBER);

        return is_int($rid) ? $rid : null;
    }
}
