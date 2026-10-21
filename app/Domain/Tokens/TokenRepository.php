<?php

declare(strict_types=1);

namespace JDR\Domain\Tokens;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to tokens (soft delete, projet.md 7.1). Reads join the image asset (uuid, deleted_at).
 */
final class TokenRepository
{
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * Live or soft-deleted token.
     */
    public function find(int $id): ?Token
    {
        $row = $this->db->fetchOne($this->select() . ' WHERE t.`id` = ?', [$id]);

        return $row === null ? null : Token::fromRow($row);
    }

    /**
     * Live tokens of a game, by name; $ownerId set => only the tokens owned by default by them.
     *
     * @return list<Token>
     */
    public function listForGame(int $gameId, ?int $ownerId = null): array
    {
        $sql = $this->select() . ' WHERE t.`game_id` = ? AND t.`deleted_at` IS NULL';
        $params = [$gameId];
        if ($ownerId !== null) {
            $sql .= ' AND t.`default_owner_user_id` = ?';
            $params[] = $ownerId;
        }
        $rows = $this->db->fetchAll($sql . ' ORDER BY t.`name`, t.`id` LIMIT 2000', $params);

        return array_map(static fn (array $r): Token => Token::fromRow($r), $rows);
    }

    /**
     * @param array<string, mixed> $values validated by TokenInput::create()
     */
    public function insert(int $gameId, array $values): int
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('tokens') . ' (`game_id`, `name`, `asset_id`, `kind`, `size_w`, `size_h`, '
            . '`default_owner_user_id`, `vision`, `light`, `ring_color`, `created_at`, `updated_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $gameId,
                $values['name'],
                $values['asset_id'],
                $values['kind'],
                $values['size_w'],
                $values['size_h'],
                $values['default_owner_user_id'],
                json_encode($values['vision'], self::JSON_FLAGS),
                $values['light'] === null ? null : json_encode($values['light'], self::JSON_FLAGS),
                $values['ring_color'],
                $now,
                $now,
            ],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $changes validated by TokenInput::patch()
     */
    public function update(int $id, array $changes): void
    {
        $sets = [];
        $params = [];
        foreach (['name', 'asset_id', 'kind', 'size_w', 'size_h', 'default_owner_user_id', 'vision', 'light', 'ring_color'] as $column) {
            if (!array_key_exists($column, $changes)) {
                continue;
            }
            $value = $changes[$column];
            if (($column === 'vision' || $column === 'light') && $value !== null) {
                $value = json_encode($value, self::JSON_FLAGS);
            }
            $sets[] = '`' . $column . '` = ?';
            $params[] = $value;
        }
        $sets[] = '`updated_at` = ?';
        $params[] = $this->clock->sql();
        $params[] = $id;
        $this->db->execute('UPDATE ' . $this->db->t('tokens') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
    }

    /**
     * Soft delete; the token also leaves every encounter.
     */
    public function softDelete(int $id): void
    {
        $now = $this->clock->sql();
        $this->db->transaction(function () use ($id, $now): void {
            $this->db->execute(
                'UPDATE ' . $this->db->t('tokens') . ' SET `deleted_at` = ?, `updated_at` = ? WHERE `id` = ? AND `deleted_at` IS NULL',
                [$now, $now, $id],
            );
            $this->db->execute('DELETE FROM ' . $this->db->t('encounter_tokens') . ' WHERE `token_id` = ?', [$id]);
        });
    }

    /**
     * A member leaves a game: their tokens of this game have no default owner any more.
     */
    public function clearOwner(int $gameId, int $userId): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('tokens') . ' SET `default_owner_user_id` = NULL, `updated_at` = ? '
            . 'WHERE `game_id` = ? AND `default_owner_user_id` = ?',
            [$this->clock->sql(), $gameId, $userId],
        );
    }

    /**
     * Account deletion: the user owns no token any more (soft-deleted users keep their row).
     */
    public function clearOwnerEverywhere(int $userId): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('tokens') . ' SET `default_owner_user_id` = NULL, `updated_at` = ? WHERE `default_owner_user_id` = ?',
            [$this->clock->sql(), $userId],
        );
    }

    /**
     * Ids among $ids of the live tokens of $gameId.
     *
     * @param list<int> $ids
     * @return list<int>
     */
    public function liveIdsInGame(int $gameId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('tokens') . ' WHERE `game_id` = ? AND `deleted_at` IS NULL AND `id` IN ('
            . implode(', ', array_fill(0, count($ids), '?')) . ')',
            [$gameId, ...$ids],
        );

        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }

    /**
     * Permanently deletes the tokens soft-deleted before $before (map_tokens and
     * encounter_tokens follow by FK CASCADE).
     */
    public function purgeDeleted(string $before, int $limit): int
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('tokens') . ' WHERE `deleted_at` IS NOT NULL AND `deleted_at` < ? ORDER BY `id` LIMIT ' . max(1, $limit),
            [$before],
        );
    }

    private function select(): string
    {
        return 'SELECT t.*, a.`uuid` AS asset_uuid, a.`deleted_at` AS asset_deleted_at FROM ' . $this->db->t('tokens') . ' t '
            . 'LEFT JOIN ' . $this->db->t('assets') . ' a ON a.`id` = t.`asset_id`';
    }
}
