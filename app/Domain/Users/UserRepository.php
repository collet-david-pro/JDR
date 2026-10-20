<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * users table. Soft-deleted accounts (deleted_at) are invisible to every finder.
 */
final class UserRepository
{
    private const COLUMNS = '`id`, `email`, `username`, `password_hash`, `role`, `status`, `storage_quota_bytes`, '
        . '`storage_used_bytes`, `locale`, `email_verified_at`, `last_login_at`, `created_at`, `deleted_at`';

    /** Columns an update may change. */
    private const UPDATABLE = [
        'email', 'username', 'password_hash', 'role', 'status', 'storage_quota_bytes', 'locale',
        'email_verified_at', 'last_login_at',
    ];

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function find(int $id): ?User
    {
        $row = $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('users') . ' WHERE `id` = ? AND `deleted_at` IS NULL',
            [$id],
        );

        return $row === null ? null : User::fromRow($row);
    }

    public function findByEmail(string $email): ?User
    {
        $row = $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('users') . ' WHERE `email` = ? AND `deleted_at` IS NULL',
            [mb_strtolower(trim($email), 'UTF-8')],
        );

        return $row === null ? null : User::fromRow($row);
    }

    /**
     * Login identifier: e-mail (contains "@") or username (case-insensitive collation).
     */
    public function findByIdentifier(string $identifier): ?User
    {
        $identifier = trim($identifier);
        if ($identifier === '' || strlen($identifier) > 191) {
            return null;
        }
        if (str_contains($identifier, '@')) {
            return $this->findByEmail($identifier);
        }
        $row = $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('users')
            . ' WHERE `username` = ? AND `deleted_at` IS NULL',
            [$identifier],
        );

        return $row === null ? null : User::fromRow($row);
    }

    /**
     * True when the e-mail is used by another account (deleted accounts are anonymized).
     */
    public function emailTaken(string $email, ?int $exceptId = null): bool
    {
        return $this->taken('email', mb_strtolower($email, 'UTF-8'), $exceptId);
    }

    public function usernameTaken(string $username, ?int $exceptId = null): bool
    {
        return $this->taken('username', $username, $exceptId);
    }

    public function insert(
        string $email,
        string $username,
        string $passwordHash,
        string $role = User::ROLE_USER,
        string $locale = 'fr',
        ?int $quota = null,
    ): int {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('users') . ' (`email`, `username`, `password_hash`, `role`, `status`, '
            . '`storage_quota_bytes`, `storage_used_bytes`, `locale`, `created_at`, `updated_at`) '
            . "VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)",
            [mb_strtolower($email, 'UTF-8'), $username, $passwordHash, $role, $quota, $locale, $now, $now],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $fields column => value (white-listed)
     */
    public function update(int $id, array $fields): void
    {
        $sets = [];
        $params = [];
        foreach ($fields as $column => $value) {
            if (!in_array($column, self::UPDATABLE, true)) {
                throw new \InvalidArgumentException('Column not updatable: ' . $column);
            }
            $sets[] = '`' . $column . '` = ?';
            $params[] = $value;
        }
        if ($sets === []) {
            return;
        }
        $sets[] = '`updated_at` = ?';
        $params[] = $this->clock->sql();
        $params[] = $id;
        $this->db->execute(
            'UPDATE ' . $this->db->t('users') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ? AND `deleted_at` IS NULL',
            $params,
        );
    }

    /**
     * Soft delete with anonymization: unique columns are freed, the password is made unusable.
     */
    public function softDelete(int $id): void
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'UPDATE ' . $this->db->t('users') . " SET `email` = ?, `username` = ?, `password_hash` = ?, "
            . "`status` = 'suspended', `email_verified_at` = NULL, `deleted_at` = ?, `updated_at` = ? "
            . 'WHERE `id` = ? AND `deleted_at` IS NULL',
            [
                'deleted-' . $id . '@deleted.invalid',
                'deleted-' . $id,
                '!deleted-' . bin2hex(random_bytes(16)),
                $now,
                $now,
                $id,
            ],
        );
    }

    /**
     * Admin listing, by id ascending; cursor = last id of the previous page.
     *
     * @return array{items: list<User>, next_cursor: string|null}
     */
    public function search(?string $q, ?string $status, ?int $cursor, int $limit): array
    {
        $where = ['`deleted_at` IS NULL'];
        $params = [];
        if ($q !== null && $q !== '') {
            $like = '%' . addcslashes(mb_strtolower($q, 'UTF-8'), '\\%_') . '%';
            $where[] = '(`email` LIKE ? OR `username` LIKE ?)';
            $params[] = $like;
            $params[] = $like;
        }
        if ($status !== null) {
            $where[] = '`status` = ?';
            $params[] = $status;
        }
        if ($cursor !== null) {
            $where[] = '`id` > ?';
            $params[] = $cursor;
        }
        $params[] = $limit + 1;
        $rows = $this->db->fetchAll(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('users') . ' WHERE ' . implode(' AND ', $where)
            . ' ORDER BY `id` ASC LIMIT ?',
            $params,
        );
        $next = null;
        if (count($rows) > $limit) {
            array_pop($rows);
            $next = (string) $rows[count($rows) - 1]['id'];
        }

        return ['items' => array_map(static fn (array $r): User => User::fromRow($r), $rows), 'next_cursor' => $next];
    }

    public function countActiveAdmins(): int
    {
        return (int) $this->db->fetchValue(
            'SELECT COUNT(*) FROM ' . $this->db->t('users')
            . " WHERE `role` = 'admin' AND `status` = 'active' AND `deleted_at` IS NULL",
        );
    }

    /**
     * @return array{total: int, active: int, suspended: int, admins: int, storage_bytes: int}
     */
    public function stats(): array
    {
        $row = $this->db->fetchOne(
            "SELECT COUNT(*) AS total, COALESCE(SUM(`status` = 'active'), 0) AS active, "
            . "COALESCE(SUM(`status` = 'suspended'), 0) AS suspended, COALESCE(SUM(`role` = 'admin'), 0) AS admins, "
            . 'COALESCE(SUM(`storage_used_bytes`), 0) AS storage_bytes FROM ' . $this->db->t('users')
            . ' WHERE `deleted_at` IS NULL',
        ) ?? [];

        return [
            'total' => (int) ($row['total'] ?? 0),
            'active' => (int) ($row['active'] ?? 0),
            'suspended' => (int) ($row['suspended'] ?? 0),
            'admins' => (int) ($row['admins'] ?? 0),
            'storage_bytes' => (int) ($row['storage_bytes'] ?? 0),
        ];
    }

    private function taken(string $column, string $value, ?int $exceptId): bool
    {
        $sql = 'SELECT 1 FROM ' . $this->db->t('users') . ' WHERE `' . $column . '` = ?';
        $params = [$value];
        if ($exceptId !== null) {
            $sql .= ' AND `id` <> ?';
            $params[] = $exceptId;
        }

        return $this->db->fetchValue($sql . ' LIMIT 1', $params) !== null;
    }
}
