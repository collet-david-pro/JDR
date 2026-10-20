<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Logger;
use JDR\Core\Request;
use JDR\Core\Session\CookieJar;
use JDR\Core\Session\CookieParams;
use JDR\Domain\Support\Dates;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserRepository;

/**
 * "Remember me" cookie jdr_remember = selector:validator (projet.md 11.1).
 * Only SHA-256(validator) is stored. The validator is rotated on every use (30 days).
 * A known selector with a wrong validator means the cookie was stolen and replayed: every
 * remember token of the account is revoked — except within RACE_GRACE seconds after the last
 * rotation, where it is most likely two parallel requests of the legitimate browser.
 */
final class RememberMe
{
    public const COOKIE = 'jdr_remember';
    public const LIFETIME = 30 * 86400;
    public const RACE_GRACE = 60;

    public function __construct(
        private RememberTokenRepository $tokens,
        private UserRepository $users,
        private CookieJar $cookies,
        private Clock $clock,
        private Logger $logger,
    ) {
    }

    public function hasCookie(Request $request): bool
    {
        return is_string($request->cookies[self::COOKIE] ?? null);
    }

    /**
     * Creates a token for this device and sets the cookie. Returns the token id.
     */
    public function issue(User $user, Request $request, CookieParams $params): int
    {
        $now = $this->clock->timestamp();
        $selector = bin2hex(random_bytes(12));
        $validator = bin2hex(random_bytes(32));
        $ua = $request->header('user-agent');
        $id = $this->tokens->insert(
            $user->id,
            $selector,
            hash('sha256', $validator),
            $ua === null || $ua === '' ? null : mb_substr($ua, 0, 255, 'UTF-8'),
            Dates::sql($now + self::LIFETIME),
            Dates::sql($now),
        );
        $this->cookies->set(self::COOKIE, $selector . ':' . $validator, $now + self::LIFETIME, $params->path, $params->secure);

        return $id;
    }

    /**
     * Logs in from the cookie: returns [user, token id] and rotates the validator, or null.
     *
     * @return array{0: User, 1: int}|null
     */
    public function consume(Request $request, CookieParams $params): ?array
    {
        $raw = $request->cookies[self::COOKIE] ?? null;
        if (!is_string($raw) || preg_match('/^([0-9a-f]{24}):([0-9a-f]{64})$/D', $raw, $m) !== 1) {
            if ($raw !== null) {
                $this->clear($params);
            }

            return null;
        }
        [, $selector, $validator] = $m;
        $row = $this->tokens->findBySelector($selector);
        if ($row === null) {
            $this->clear($params);

            return null;
        }
        $now = $this->clock->timestamp();
        $id = (int) $row['id'];
        if ((Dates::timestamp($row['expires_at']) ?? 0) <= $now) {
            $this->tokens->delete($id);
            $this->clear($params);

            return null;
        }
        if (!hash_equals((string) $row['validator_hash'], hash('sha256', $validator))) {
            $lastUsed = Dates::timestamp($row['last_used_at']) ?? 0;
            if ($now - $lastUsed <= self::RACE_GRACE) {
                return null;
            }
            $count = $this->tokens->deleteForUser((int) $row['user_id']);
            $this->logger->warning('Remember-me token replay detected: all devices revoked', [
                'account' => (int) $row['user_id'],
                'revoked' => $count,
            ]);
            $this->clear($params);

            return null;
        }
        $user = $this->users->find((int) $row['user_id']);
        if ($user === null || !$user->isActive()) {
            $this->tokens->delete($id);
            $this->clear($params);

            return null;
        }
        $newValidator = bin2hex(random_bytes(32));
        $this->tokens->rotate($id, hash('sha256', $newValidator), Dates::sql($now + self::LIFETIME), Dates::sql($now));
        $this->cookies->set(
            self::COOKIE,
            $selector . ':' . $newValidator,
            $now + self::LIFETIME,
            $params->path,
            $params->secure,
        );

        return [$user, $id];
    }

    /**
     * Logout: deletes the token of this device and expires the cookie.
     */
    public function forget(Request $request, CookieParams $params): void
    {
        $raw = $request->cookies[self::COOKIE] ?? null;
        if (is_string($raw) && preg_match('/^([0-9a-f]{24}):/', $raw, $m) === 1) {
            $row = $this->tokens->findBySelector($m[1]);
            if ($row !== null) {
                $this->tokens->delete((int) $row['id']);
            }
        }
        if ($raw !== null) {
            $this->clear($params);
        }
    }

    public function clear(CookieParams $params): void
    {
        $this->cookies->set(self::COOKIE, '', 1, $params->path, $params->secure);
    }
}
