<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\GoneException;
use JDR\Core\Errors\RateLimitedException;
use JDR\Core\Errors\UnauthenticatedException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\I18n;
use JDR\Core\Logger;
use JDR\Core\RateLimiter;
use JDR\Core\Request;
use JDR\Core\Session\CookieParams;
use JDR\Core\Session\Session;
use JDR\Domain\Invitations\InvitationService;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserRepository;
use JDR\Mail\Mailer;

/**
 * Registration, login, logout, forgotten password and reset (projet.md 11.1).
 */
final class AuthService
{
    /** Fallbacks when i18n lacks the mail.reset.* keys. */
    private const RESET_SUBJECT = '{site} : réinitialisation du mot de passe';
    private const RESET_BODY = "Bonjour {username},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien "
        . "(valable 1 heure, utilisable une seule fois) :\n{url}\n\n"
        . "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n";

    public function __construct(
        private Db $db,
        private Clock $clock,
        private UserRepository $users,
        private Settings $settings,
        private InvitationService $invitations,
        private RateLimiter $limiter,
        private LoginAttempts $attempts,
        private RememberMe $remember,
        private RememberTokenRepository $tokens,
        private Authenticator $authenticator,
        private PasswordResets $resets,
        private Mailer $mailer,
        private I18n $i18n,
        private Logger $logger,
    ) {
    }

    /**
     * @return array{user: User, csrf: string}
     * @throws ForbiddenException registration_closed
     * @throws ValidationException
     */
    public function register(
        ?string $email,
        ?string $username,
        #[\SensitiveParameter] ?string $password,
        ?string $invitationCode,
        Session $session,
    ): array {
        $mode = $this->settings->registrationMode();
        if ($mode === 'closed') {
            throw new ForbiddenException('', [], 'registration_closed');
        }
        $errors = [];
        if ($mode === 'invite' && ($invitationCode === null || $invitationCode === '')) {
            $errors['invitation_code'] = 'required';
        }
        if ($email !== null && $this->users->emailTaken($email)) {
            $errors['email'] = 'taken';
        }
        if ($username !== null && $this->users->usernameTaken($username)) {
            $errors['username'] = 'taken';
        }
        if ($errors !== [] || $email === null || $username === null || $password === null) {
            throw new ValidationException('', $errors);
        }
        $hash = Passwords::hash($password);
        $locale = $this->settings->string('default_locale');
        try {
            $id = $this->db->transaction(function () use ($mode, $invitationCode, $email, $username, $hash, $locale): int {
                if ($mode === 'invite') {
                    $this->invitations->consume((string) $invitationCode, $email);
                }

                return $this->users->insert($email, $username, $hash, User::ROLE_USER, $locale === '' ? 'fr' : $locale);
            });
        } catch (\PDOException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new ValidationException('', [
                    str_contains($e->getMessage(), 'uq_username') ? 'username' : 'email' => 'taken',
                ]);
            }
            throw $e;
        }
        $user = $this->users->find($id) ?? throw new \RuntimeException('User vanished after insert.');
        $this->users->update($user->id, ['last_login_at' => $this->clock->sql()]);
        $user = $this->users->find($id) ?? $user;
        $csrf = $this->authenticator->login($session, $user, null);

        return ['user' => $user, 'csrf' => $csrf];
    }

    /**
     * Same answer and comparable delay for an unknown account and a wrong password.
     *
     * @return array{user: User, csrf: string}
     * @throws UnauthenticatedException invalid_credentials
     * @throws RateLimitedException
     * @throws ForbiddenException account_suspended (right password, suspended account)
     */
    public function login(
        string $identifier,
        #[\SensitiveParameter] string $password,
        bool $remember,
        Request $request,
        Session $session,
        CookieParams $cookies,
    ): array {
        $ip = $request->ip();
        $bucket = self::loginBucket($identifier, $ip);
        $wait = $this->limiter->tooMany($bucket);
        if ($wait !== null) {
            throw new RateLimitedException($wait);
        }
        $user = $this->users->findByIdentifier($identifier);
        if ($user === null) {
            Passwords::dummyVerify($password);
            $valid = false;
        } else {
            $valid = Passwords::verify($password, $user->passwordHash());
        }
        if (!$valid || $user === null) {
            $this->attempts->record($identifier, $ip, false);
            $def = RateLimiter::definition('login');
            $this->limiter->hit($bucket, $def['limit'], $def['window']);
            throw new UnauthenticatedException('', [], 'invalid_credentials');
        }
        if (!$user->isActive()) {
            $this->attempts->record($identifier, $ip, false);
            throw new ForbiddenException('', [], 'account_suspended');
        }
        $this->attempts->record($identifier, $ip, true);
        $this->limiter->clear($bucket);
        $fields = ['last_login_at' => $this->clock->sql()];
        if (Passwords::needsRehash($user->passwordHash())) {
            $fields['password_hash'] = Passwords::hash($password);
        }
        $this->users->update($user->id, $fields);
        $user = $this->users->find($user->id) ?? $user;
        $rememberId = $remember ? $this->remember->issue($user, $request, $cookies) : null;
        $csrf = $this->authenticator->login($session, $user, $rememberId);

        return ['user' => $user, 'csrf' => $csrf];
    }

    /**
     * @param array<string, string> $params
     */
    private function text(string $key, string $fallback, array $params): string
    {
        if ($this->i18n->has($key)) {
            return $this->i18n->t($key, $params);
        }
        foreach ($params as $name => $value) {
            $fallback = str_replace('{' . $name . '}', $value, $fallback);
        }

        return $fallback;
    }

    public static function loginBucket(string $identifier, string $ip): string
    {
        return RateLimiter::key('login', $identifier, $ip);
    }

    public function logout(Request $request, Session $session, CookieParams $cookies): void
    {
        $this->remember->forget($request, $cookies);
        $session->destroy();
    }

    /**
     * Sends a reset link when SMTP is configured and the account exists; the answer never tells.
     *
     * @return string "email" | "contact_admin"
     */
    public function forgot(string $email): string
    {
        if (!$this->mailer->isEnabled()) {
            return 'contact_admin';
        }
        $user = $this->users->findByEmail($email);
        if ($user !== null && $user->isActive()) {
            $link = $this->resets->create($user->id, null);
            $site = $this->settings->string('site_name');
            try {
                $params = ['site' => $site, 'username' => $user->username, 'url' => $link['url']];
                $this->mailer->send(
                    $user->email,
                    $this->text('mail.reset.subject', self::RESET_SUBJECT, $params),
                    $this->text('mail.reset.body', self::RESET_BODY, $params),
                );
            } catch (\RuntimeException $e) {
                $this->logger->warning('Password reset e-mail not sent', ['error' => $e->getMessage()]);
            }
        }

        return 'email';
    }

    /**
     * Consumes a reset link and sets the new password. Every session and remember token of the
     * account is revoked (the session fingerprint changes with the password).
     *
     * @throws GoneException reset_link_invalid
     */
    public function reset(string $token, #[\SensitiveParameter] string $password): void
    {
        $hash = Passwords::hash($password);
        $this->db->transaction(function () use ($token, $hash): void {
            $userId = $this->resets->consume($token);
            $user = $this->users->find($userId);
            if ($user === null) {
                throw new GoneException('', [], 'reset_link_invalid');
            }
            $this->users->update($userId, ['password_hash' => $hash]);
            $this->resets->revokeForUser($userId);
            $this->tokens->deleteForUser($userId);
        });
    }
}
