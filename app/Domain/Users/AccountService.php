<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\Passwords;
use JDR\Domain\Auth\PasswordResets;
use JDR\Domain\Auth\RememberTokenRepository;
use JDR\Domain\Support\Dates;

/**
 * Self-service account operations (profile, password, devices, export, deletion).
 */
final class AccountService
{
    public function __construct(
        private Clock $clock,
        private UserRepository $users,
        private UserPrefs $prefs,
        private RememberTokenRepository $tokens,
        private PasswordResets $resets,
        private AccountDeletion $deletion,
        private AuditLog $audit,
        private UserDataExtensions $extensions,
    ) {
    }

    /**
     * @param array{username?: string, email?: string, locale?: string} $changes validated values
     * @throws ValidationException taken, wrong_password, required
     */
    public function updateProfile(User $user, array $changes, #[\SensitiveParameter] ?string $currentPassword): User
    {
        $fields = [];
        $errors = [];
        if (isset($changes['username']) && $changes['username'] !== $user->username) {
            if ($this->users->usernameTaken($changes['username'], $user->id)) {
                $errors['username'] = 'taken';
            }
            $fields['username'] = $changes['username'];
        }
        if (isset($changes['email']) && $changes['email'] !== $user->email) {
            if ($currentPassword === null) {
                $errors['current_password'] = 'required';
            } elseif (!Passwords::verify($currentPassword, $user->passwordHash())) {
                $errors['current_password'] = 'wrong_password';
            }
            if ($this->users->emailTaken($changes['email'], $user->id)) {
                $errors['email'] = 'taken';
            }
            $fields['email'] = $changes['email'];
            $fields['email_verified_at'] = null;
        }
        if (isset($changes['locale'])) {
            $fields['locale'] = $changes['locale'];
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $this->users->update($user->id, $fields);

        return $this->users->find($user->id) ?? $user;
    }

    /**
     * Changes the password; other sessions die (fingerprint), other devices are revoked.
     *
     * @throws ValidationException wrong_password
     */
    public function changePassword(
        User $user,
        #[\SensitiveParameter] string $current,
        #[\SensitiveParameter] string $new,
        ?int $currentDeviceId,
    ): User {
        if (!Passwords::verify($current, $user->passwordHash())) {
            throw new ValidationException('', ['current_password' => 'wrong_password']);
        }
        $this->users->update($user->id, ['password_hash' => Passwords::hash($new)]);
        $this->tokens->deleteForUser($user->id, $currentDeviceId);
        $this->resets->revokeForUser($user->id);

        return $this->users->find($user->id) ?? $user;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function devices(User $user, ?int $currentDeviceId): array
    {
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'user_agent' => (string) ($r['user_agent'] ?? ''),
            'created_at' => Dates::iso($r['created_at']),
            'last_used_at' => Dates::iso($r['last_used_at']),
            'current' => (int) $r['id'] === $currentDeviceId,
        ], $this->tokens->forUser($user->id, $this->clock->sql()));
    }

    public function revokeDevice(User $user, int $deviceId): bool
    {
        return $this->tokens->deleteOwned($user->id, $deviceId);
    }

    /**
     * Personal data export (RGPD), extended by UserDataExtension.
     *
     * @return array<string, mixed>
     */
    public function export(User $user): array
    {
        $document = [
            'format' => 'jdr-personal-data',
            'version' => 1,
            'generated_at' => Dates::isoFromTimestamp($this->clock->timestamp()),
            'user' => $user->toPublic(),
            'prefs' => $this->prefs->all($user->id),
            'devices' => $this->devices($user, null),
            'audit' => $this->audit->byUser($user->id),
        ];
        foreach ($this->extensions->all() as $extension) {
            $document[$extension->name()] = $extension->export($user);
        }

        return $document;
    }

    /**
     * @throws ValidationException wrong_password
     * @throws ConflictException last_admin
     */
    public function deleteAccount(User $user, #[\SensitiveParameter] string $password): void
    {
        if (!Passwords::verify($password, $user->passwordHash())) {
            throw new ValidationException('', ['password' => 'wrong_password']);
        }
        if ($user->isAdmin() && $this->users->countActiveAdmins() <= 1) {
            throw new ConflictException('', [], 'last_admin');
        }
        $this->deletion->delete($user, null, null);
    }
}
