<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\PasswordResets;
use JDR\Domain\Auth\RememberTokenRepository;
use JDR\Domain\Invitations\InvitationRepository;

/**
 * Account deletion (projet.md 11.1), by the user (DELETE /me) or an admin:
 * domain extensions first (games, assets... from P2 on), then soft delete with anonymization,
 * purge of preferences, devices, reset links and invitations, anonymization of the audit log.
 */
final class AccountDeletion
{
    public function __construct(
        private Db $db,
        private UserRepository $users,
        private UserPrefs $prefs,
        private RememberTokenRepository $tokens,
        private PasswordResets $resets,
        private InvitationRepository $invitations,
        private AuditLog $audit,
        private UserDataExtensions $extensions,
    ) {
    }

    public function delete(User $user, ?int $actorId, ?string $ip): void
    {
        $this->db->transaction(function () use ($user, $actorId, $ip): void {
            foreach ($this->extensions->all() as $extension) {
                $extension->deleteUserData($user);
            }
            $this->prefs->deleteAll($user->id);
            $this->tokens->deleteForUser($user->id);
            $this->resets->revokeForUser($user->id);
            $this->invitations->deleteCreatedBy($user->id);
            $this->users->softDelete($user->id);
            $this->audit->anonymizeUser($user->id);
            $self = $actorId === null || $actorId === $user->id;
            $this->audit->record(
                $self ? null : $actorId,
                $self ? 'user.delete_self' : 'user.delete',
                'user',
                $user->id,
                null,
                $self ? null : $ip,
            );
        });
    }
}
