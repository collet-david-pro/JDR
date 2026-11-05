<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * remember_tokens ("remember me" cookies = connected devices).
 */
final class RememberTokenRepository
{
    public function __construct(private Db $db)
    {
    }

    /**
     * Stores a new remember-me token and returns its id.
     */
    public function insert(int $userId, string $selector, string $validatorHash, ?string $userAgent, string $expiresAt, string $now): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('remember_tokens')
            . ' (`user_id`, `selector`, `validator_hash`, `user_agent`, `expires_at`, `last_used_at`, `created_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$userId, $selector, $validatorHash, $userAgent, $expiresAt, $now, $now],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findBySelector(string $selector): ?array
    {
        return $this->db->fetchOne(
            'SELECT `id`, `user_id`, `validator_hash`, `expires_at`, `last_used_at` FROM '
            . $this->db->t('remember_tokens') . ' WHERE `selector` = ?',
            [$selector],
        );
    }

    /**
     * Replaces the validator hash and expiry of a token after use.
     */
    public function rotate(int $id, string $validatorHash, string $expiresAt, string $now): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('remember_tokens')
            . ' SET `validator_hash` = ?, `expires_at` = ?, `last_used_at` = ? WHERE `id` = ?',
            [$validatorHash, $expiresAt, $now, $id],
        );
    }

    /**
     * Deletes a token.
     */
    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('remember_tokens') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Deletes all tokens of the user, optionally keeping one, and returns how many.
     */
    public function deleteForUser(int $userId, ?int $exceptId = null): int
    {
        if ($exceptId === null) {
            return $this->db->execute(
                'DELETE FROM ' . $this->db->t('remember_tokens') . ' WHERE `user_id` = ?',
                [$userId],
            );
        }

        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('remember_tokens') . ' WHERE `user_id` = ? AND `id` <> ?',
            [$userId, $exceptId],
        );
    }

    /**
     * Deletes the token only if it belongs to the user; returns whether one was removed.
     */
    public function deleteOwned(int $userId, int $id): bool
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('remember_tokens') . ' WHERE `user_id` = ? AND `id` = ?',
            [$userId, $id],
        ) > 0;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function forUser(int $userId, string $now): array
    {
        return $this->db->fetchAll(
            'SELECT `id`, `user_agent`, `created_at`, `last_used_at`, `expires_at` FROM ' . $this->db->t('remember_tokens')
            . ' WHERE `user_id` = ? AND `expires_at` > ? ORDER BY `last_used_at` DESC, `id` DESC',
            [$userId, $now],
        );
    }
}
