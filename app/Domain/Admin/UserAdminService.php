<?php

declare(strict_types=1);

namespace JDR\Domain\Admin;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\DbSessionHandler;
use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\Passwords;
use JDR\Domain\Auth\PasswordResets;
use JDR\Domain\Auth\RememberTokenRepository;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Users\AccountDeletion;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserRepository;

/**
 * Account management by the site admin. Every action is written to the audit log.
 * An admin cannot suspend, demote or delete themself, nor the last active admin.
 */
final class UserAdminService
{
    public function __construct(
        private Db $db,
        private UserRepository $users,
        private RememberTokenRepository $tokens,
        private PasswordResets $resets,
        private AccountDeletion $deletion,
        private AuditLog $audit,
        private Settings $settings,
        private DbSessionHandler $dbSessions,
    ) {
    }

    public function get(int $id): User
    {
        return $this->users->find($id) ?? throw new NotFoundException();
    }

    /**
     * Without a password, the account gets an unusable one and a reset link is returned.
     *
     * @return array{user: User, reset_link: array{url: string, expires_at: string}|null}
     */
    public function create(
        User $admin,
        string $email,
        string $username,
        string $role,
        #[\SensitiveParameter] ?string $password,
        string $ip,
    ): array {
        $errors = [];
        if ($this->users->emailTaken($email)) {
            $errors['email'] = 'taken';
        }
        if ($this->users->usernameTaken($username)) {
            $errors['username'] = 'taken';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $hash = $password === null ? '!unset-' . bin2hex(random_bytes(16)) : Passwords::hash($password);
        $locale = $this->settings->string('default_locale');

        return $this->db->transaction(function () use ($admin, $email, $username, $role, $password, $hash, $locale, $ip): array {
            $id = $this->users->insert($email, $username, $hash, $role, $locale === '' ? 'fr' : $locale);
            $link = null;
            if ($password === null) {
                $created = $this->resets->create($id, $admin->id);
                $link = ['url' => $created['url'], 'expires_at' => $created['expires_at']];
            }
            $this->audit->record($admin->id, 'user.create', 'user', $id, [
                'email' => $email,
                'username' => $username,
                'role' => $role,
            ], $ip);

            return ['user' => $this->get($id), 'reset_link' => $link];
        });
    }

    /**
     * @param array{username?: string, email?: string, role?: string, storage_quota_bytes?: int|null} $changes
     */
    public function update(User $admin, int $id, array $changes, string $ip): User
    {
        $user = $this->get($id);
        $fields = [];
        $errors = [];
        if (isset($changes['username']) && $changes['username'] !== $user->username) {
            if ($this->users->usernameTaken($changes['username'], $id)) {
                $errors['username'] = 'taken';
            }
            $fields['username'] = $changes['username'];
        }
        if (isset($changes['email']) && $changes['email'] !== $user->email) {
            if ($this->users->emailTaken($changes['email'], $id)) {
                $errors['email'] = 'taken';
            }
            $fields['email'] = $changes['email'];
            $fields['email_verified_at'] = null;
        }
        if (isset($changes['role']) && $changes['role'] !== $user->role) {
            if ($user->id === $admin->id) {
                throw new ConflictException('', [], 'self_action');
            }
            if ($user->isAdmin() && $user->isActive() && $this->users->countActiveAdmins() <= 1) {
                throw new ConflictException('', [], 'last_admin');
            }
            $fields['role'] = $changes['role'];
        }
        if (array_key_exists('storage_quota_bytes', $changes)) {
            $fields['storage_quota_bytes'] = $changes['storage_quota_bytes'];
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        if ($fields !== []) {
            $this->users->update($id, $fields);
            $data = $fields;
            unset($data['email_verified_at']);
            $this->audit->record($admin->id, array_key_exists('storage_quota_bytes', $fields) && count($fields) === 1
                ? 'quota.change' : 'user.update', 'user', $id, $data, $ip);
        }

        return $this->get($id);
    }

    /**
     * Suspension: remember tokens purged, sessions refused from the next request on
     * (the Auth middleware re-reads the status), database sessions deleted.
     */
    public function suspend(User $admin, int $id, string $ip): User
    {
        $user = $this->get($id);
        if ($user->id === $admin->id) {
            throw new ConflictException('', [], 'self_action');
        }
        if ($user->isAdmin() && $user->isActive() && $this->users->countActiveAdmins() <= 1) {
            throw new ConflictException('', [], 'last_admin');
        }
        $this->db->transaction(function () use ($admin, $id, $ip): void {
            $this->users->update($id, ['status' => User::STATUS_SUSPENDED]);
            $this->tokens->deleteForUser($id);
            $this->resets->revokeForUser($id);
            $this->audit->record($admin->id, 'user.suspend', 'user', $id, null, $ip);
        });
        if ($this->settings->bool('use_db_sessions')) {
            $this->dbSessions->destroyUser($id);
        }

        return $this->get($id);
    }

    public function unsuspend(User $admin, int $id, string $ip): User
    {
        $this->get($id);
        $this->users->update($id, ['status' => User::STATUS_ACTIVE]);
        $this->audit->record($admin->id, 'user.unsuspend', 'user', $id, null, $ip);

        return $this->get($id);
    }

    /**
     * @return array{url: string, expires_at: string}
     */
    public function resetLink(User $admin, int $id, string $ip): array
    {
        $user = $this->get($id);
        $link = $this->resets->create($user->id, $admin->id);
        $this->audit->record($admin->id, 'user.reset_link', 'user', $id, null, $ip);

        return ['url' => $link['url'], 'expires_at' => $link['expires_at']];
    }

    public function delete(User $admin, int $id, string $ip): void
    {
        $user = $this->get($id);
        if ($user->id === $admin->id) {
            throw new ConflictException('', [], 'self_action');
        }
        if ($user->isAdmin() && $user->isActive() && $this->users->countActiveAdmins() <= 1) {
            throw new ConflictException('', [], 'last_admin');
        }
        $this->deletion->delete($user, $admin->id, $ip);
        if ($this->settings->bool('use_db_sessions')) {
            $this->dbSessions->destroyUser($id);
        }
    }
}
