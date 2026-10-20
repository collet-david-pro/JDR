<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Ids;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\Session\CookieParams;
use JDR\Domain\Auth\Authenticator;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Auth\RememberMe;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Support\Validator;
use JDR\Domain\Users\AccountService;
use JDR\Domain\Users\UserPrefs;

/**
 * /me/*: the connected user's own account (routes with auth=true).
 */
final class MeController
{
    private const LOCALES = ['fr'];

    public function __construct(
        private AccountService $account,
        private UserPrefs $prefs,
        private Authenticator $authenticator,
        private RememberMe $remember,
        private Settings $settings,
    ) {
    }

    /**
     * PATCH /me {username?, email?, locale?, current_password?} -> {user}
     */
    public function update(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $changes = [];
        if ($v->has('username')) {
            $changes['username'] = $v->username('username');
        }
        if ($v->has('email')) {
            $changes['email'] = $v->email('email');
        }
        if ($v->has('locale')) {
            $changes['locale'] = $v->in('locale', self::LOCALES);
        }
        $current = $v->password('current_password', false);
        $v->validate();
        /** @var array{username?: string, email?: string, locale?: string} $changes */
        $changes = array_filter($changes, static fn (?string $value): bool => $value !== null);
        $updated = $this->account->updateProfile($user, $changes, $current);

        return Response::ok(['user' => $updated->toPublic()]);
    }

    /**
     * POST /me/password {current_password, new_password} -> 204
     */
    public function password(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $session = CurrentUser::session($request);
        $v = Validator::fromRequest($request);
        $current = $v->password('current_password');
        $new = $v->newPassword('new_password');
        $v->validate();
        $updated = $this->account->changePassword(
            $user,
            (string) $current,
            (string) $new,
            $this->authenticator->rememberTokenId($session),
        );
        $session->regenerate();
        $this->authenticator->refreshFingerprint($session, $updated);

        return Response::noContent();
    }

    /**
     * PUT /me/prefs/{key} {value} -> 204 (null value = delete)
     */
    public function putPref(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $body = $request->parsedBody();
        if (!is_array($body) || !array_key_exists('value', $body)) {
            throw new ValidationException('', ['value' => 'required']);
        }
        $this->prefs->put($user->id, (string) $request->param('key'), $body['value']);

        return Response::noContent();
    }

    /**
     * GET /me/devices -> [{id, user_agent, created_at, last_used_at, current}]
     */
    public function devices(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $current = $this->authenticator->rememberTokenId(CurrentUser::session($request));

        return Response::ok($this->account->devices($user, $current));
    }

    /**
     * DELETE /me/devices/{id} -> 204
     */
    public function deleteDevice(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $id = (int) $request->param('id');
        if (!$this->account->revokeDevice($user, $id)) {
            throw new NotFoundException();
        }
        $session = CurrentUser::session($request);
        if ($this->authenticator->rememberTokenId($session) === $id) {
            $session->remove(Authenticator::KEY_REMEMBER);
            $params = $request->attribute('cookie_params');
            if ($params instanceof CookieParams) {
                $this->remember->clear($params);
            }
        }

        return Response::noContent();
    }

    /**
     * GET /me/storage -> {used_bytes, quota_bytes}
     */
    public function storage(Request $request): Response
    {
        $user = CurrentUser::require($request);

        return Response::ok([
            'used_bytes' => $user->storageUsedBytes,
            'quota_bytes' => $user->storageQuotaBytes ?? $this->settings->int('default_quota_bytes'),
        ]);
    }

    /**
     * GET /me/export -> JSON document as an attachment (not wrapped in the API envelope).
     */
    public function export(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $document = Ids::stringify($this->account->export($user));
        $name = 'jdr-export-' . gmdate('Ymd') . '.json';

        return Response::json($document, 200, [
            'Content-Disposition' => 'attachment; filename="' . $name . '"',
        ]);
    }

    /**
     * DELETE /me {password} -> 204
     */
    public function delete(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $password = $v->password('password');
        $v->validate();
        $this->account->deleteAccount($user, (string) $password);
        $params = $request->attribute('cookie_params');
        if ($params instanceof CookieParams) {
            $this->remember->clear($params);
        }
        CurrentUser::session($request)->destroy();

        return Response::noContent();
    }
}
