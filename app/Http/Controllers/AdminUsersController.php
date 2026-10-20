<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Admin\UserAdminService;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Support\Validator;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserRepository;

/**
 * /admin/users (routes with role=admin).
 */
final class AdminUsersController
{
    private const ROLES = [User::ROLE_USER, User::ROLE_ADMIN];

    public function __construct(private UserAdminService $admin, private UserRepository $users)
    {
    }

    /**
     * GET /admin/users?q=&status=&cursor=&limit= -> User[] + meta.next_cursor
     */
    public function index(Request $request): Response
    {
        $q = self::queryString($request, 'q', 100);
        $status = self::queryString($request, 'status', 20);
        if ($status !== null && !in_array($status, [User::STATUS_ACTIVE, User::STATUS_SUSPENDED], true)) {
            throw new ValidationException('', ['status' => 'invalid']);
        }
        [$cursor, $limit] = self::paging($request);
        $page = $this->users->search($q, $status, $cursor, $limit);

        return Response::ok(
            array_map(static fn (User $u): array => $u->toPublic(), $page['items']),
            ['next_cursor' => $page['next_cursor']],
        );
    }

    /**
     * POST /admin/users {email, username, role, password?} -> 201 {user, reset_link}
     */
    public function create(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $email = $v->email('email');
        $username = $v->username('username');
        $role = $v->in('role', self::ROLES, false) ?? User::ROLE_USER;
        $password = $v->newPassword('password', false);
        $v->validate();
        $result = $this->admin->create($admin, (string) $email, (string) $username, $role, $password, $request->ip());

        return Response::ok(['user' => $result['user']->toPublic(), 'reset_link' => $result['reset_link']], [], 201);
    }

    /**
     * PATCH /admin/users/{id} {username?, email?, role?, storage_quota_bytes?} -> {user}
     */
    public function update(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $changes = [];
        if ($v->has('username')) {
            $changes['username'] = $v->username('username');
        }
        if ($v->has('email')) {
            $changes['email'] = $v->email('email');
        }
        if ($v->has('role')) {
            $changes['role'] = $v->in('role', self::ROLES);
        }
        $quotaGiven = $v->has('storage_quota_bytes');
        $quota = $quotaGiven && $v->raw('storage_quota_bytes') !== null
            ? $v->int('storage_quota_bytes', true, 0, PHP_INT_MAX)
            : null;
        $v->validate();
        $changes = array_filter($changes, static fn (?string $value): bool => $value !== null);
        if ($quotaGiven) {
            $changes['storage_quota_bytes'] = $quota;
        }
        /** @var array{username?: string, email?: string, role?: string, storage_quota_bytes?: int|null} $changes */
        $user = $this->admin->update($admin, self::id($request), $changes, $request->ip());

        return Response::ok(['user' => $user->toPublic()]);
    }

    public function suspend(Request $request): Response
    {
        $user = $this->admin->suspend(CurrentUser::require($request), self::id($request), $request->ip());

        return Response::ok(['user' => $user->toPublic()]);
    }

    public function unsuspend(Request $request): Response
    {
        $user = $this->admin->unsuspend(CurrentUser::require($request), self::id($request), $request->ip());

        return Response::ok(['user' => $user->toPublic()]);
    }

    /**
     * POST /admin/users/{id}/reset-link -> {url, expires_at}
     */
    public function resetLink(Request $request): Response
    {
        return Response::ok($this->admin->resetLink(CurrentUser::require($request), self::id($request), $request->ip()));
    }

    public function delete(Request $request): Response
    {
        $this->admin->delete(CurrentUser::require($request), self::id($request), $request->ip());

        return Response::noContent();
    }

    private static function id(Request $request): int
    {
        return (int) $request->param('id');
    }

    public static function queryString(Request $request, string $key, int $max): ?string
    {
        $value = $request->query[$key] ?? null;
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return mb_substr(trim($value), 0, $max, 'UTF-8');
    }

    /**
     * ?cursor=&limit= (default 50, max 200).
     *
     * @return array{0: int|null, 1: int}
     */
    public static function paging(Request $request): array
    {
        $cursor = $request->query['cursor'] ?? null;
        $limit = $request->query['limit'] ?? null;
        $cursor = is_string($cursor) && ctype_digit($cursor) && $cursor !== '' ? (int) $cursor : null;
        $limit = is_string($limit) && ctype_digit($limit) ? max(1, min(200, (int) $limit)) : 50;

        return [$cursor, $limit];
    }
}
