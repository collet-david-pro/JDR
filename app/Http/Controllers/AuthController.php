<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\Session\CookieParams;
use JDR\Domain\Auth\AuthService;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Support\Validator;
use JDR\Domain\Users\UserPrefs;
use JDR\Mail\Mailer;

/**
 * /auth/*: current user, registration, login, logout, forgotten password, reset.
 */
final class AuthController
{
    public function __construct(
        private AuthService $auth,
        private Settings $settings,
        private UserPrefs $prefs,
        private Mailer $mailer,
    ) {
    }

    /**
     * GET /auth/me (public): creates the anonymous session and its CSRF token.
     */
    public function me(Request $request): Response
    {
        $user = CurrentUser::of($request);
        $csrf = CurrentUser::session($request)->csrfToken();
        $prefs = $user === null ? [] : $this->prefs->all($user->id);

        return Response::ok([
            'user' => $user?->toPublic(),
            'csrf' => $csrf,
            'prefs' => $prefs === [] ? new \stdClass() : $prefs,
            'registration_mode' => $this->settings->registrationMode(),
            'smtp_enabled' => $this->mailer->isEnabled(),
        ]);
    }

    /**
     * POST /auth/register {email, username, password, invitation_code?} -> 201 {user, csrf}
     */
    public function register(Request $request): Response
    {
        if ($this->settings->registrationMode() === 'closed') {
            throw new ForbiddenException('', [], 'registration_closed');
        }
        $v = Validator::fromRequest($request);
        $email = $v->email('email');
        $username = $v->username('username');
        $password = $v->newPassword('password');
        $code = $v->string('invitation_code', false, 1, 64);
        $v->validate();
        $result = $this->auth->register($email, $username, $password, $code, CurrentUser::session($request));

        return Response::ok(['user' => $result['user']->toPublic(), 'csrf' => $result['csrf']], [], 201);
    }

    /**
     * POST /auth/login {identifier, password, remember} -> {user, csrf}
     */
    public function login(Request $request): Response
    {
        $v = Validator::fromRequest($request);
        $identifier = $v->string('identifier', true, 1, 191);
        $password = $v->password('password');
        $remember = $v->bool('remember', false) ?? false;
        $v->validate();
        $result = $this->auth->login(
            (string) $identifier,
            (string) $password,
            $remember,
            $request,
            CurrentUser::session($request),
            $this->cookieParams($request),
        );

        return Response::ok(['user' => $result['user']->toPublic(), 'csrf' => $result['csrf']]);
    }

    /**
     * POST /auth/logout -> 204
     */
    public function logout(Request $request): Response
    {
        $this->auth->logout($request, CurrentUser::session($request), $this->cookieParams($request));

        return Response::noContent();
    }

    /**
     * POST /auth/password/forgot {email} -> {mode: email|contact_admin}
     */
    public function forgot(Request $request): Response
    {
        $v = Validator::fromRequest($request);
        $email = $v->email('email');
        $v->validate();

        return Response::ok(['mode' => $this->auth->forgot((string) $email)]);
    }

    /**
     * POST /auth/password/reset {token, password} -> {}
     */
    public function reset(Request $request): Response
    {
        $v = Validator::fromRequest($request);
        $token = $v->string('token', true, 1, 300);
        $password = $v->newPassword('password');
        $v->validate();
        $this->auth->reset((string) $token, (string) $password);

        return Response::ok(new \stdClass());
    }

    private function cookieParams(Request $request): CookieParams
    {
        $params = $request->attribute('cookie_params');

        return $params instanceof CookieParams ? $params : new CookieParams('/', false);
    }
}
