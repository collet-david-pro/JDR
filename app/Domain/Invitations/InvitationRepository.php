<?php

declare(strict_types=1);

namespace JDR\Domain\Invitations;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * invitations (code stored as SHA-256 only).
 */
final class InvitationRepository
{
    private const COLUMNS = '`id`, `email`, `created_by`, `max_uses`, `uses`, `expires_at`, `created_at`';

    public function __construct(private Db $db)
    {
    }

    public function insert(string $codeHash, ?string $email, int $createdBy, int $maxUses, ?string $expiresAt, string $now): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('invitations')
            . ' (`code_hash`, `email`, `created_by`, `max_uses`, `uses`, `expires_at`, `created_at`) '
            . 'VALUES (?, ?, ?, ?, 0, ?, ?)',
            [$codeHash, $email, $createdBy, $maxUses, $expiresAt, $now],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(int $id): ?array
    {
        return $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('invitations') . ' WHERE `id` = ?',
            [$id],
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findByHash(string $codeHash, bool $forUpdate = false): ?array
    {
        return $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('invitations') . ' WHERE `code_hash` = ?'
            . ($forUpdate ? ' FOR UPDATE' : ''),
            [$codeHash],
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function all(int $limit = 500): array
    {
        return $this->db->fetchAll(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('invitations') . ' ORDER BY `id` DESC LIMIT ?',
            [$limit],
        );
    }

    public function incrementUses(int $id): void
    {
        $this->db->execute('UPDATE ' . $this->db->t('invitations') . ' SET `uses` = `uses` + 1 WHERE `id` = ?', [$id]);
    }

    public function delete(int $id): bool
    {
        return $this->db->execute('DELETE FROM ' . $this->db->t('invitations') . ' WHERE `id` = ?', [$id]) > 0;
    }

    public function deleteCreatedBy(int $userId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('invitations') . ' WHERE `created_by` = ?', [$userId]);
    }
}
