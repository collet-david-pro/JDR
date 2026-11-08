<?php

declare(strict_types=1);

namespace JDR\Domain\PlayerTokens;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to the personal token collection (player_tokens) and to the per-game choices
 * (game_token_choices). Every read of a single token is scoped to its owner.
 */
final class PlayerTokenRepository
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * Tokens of an account, newest first, with the image uuids and the number of games using them.
     *
     * @return list<array<string, mixed>>
     */
    public function listOf(int $userId): array
    {
        return $this->db->fetchAll(
            $this->select() . ' WHERE p.`user_id` = ? ORDER BY p.`id` DESC LIMIT 200',
            [$userId],
        );
    }

    /**
     * @return array<string, mixed>|null the token of $userId only
     */
    public function findOf(int $userId, int $id): ?array
    {
        return $this->db->fetchOne($this->select() . ' WHERE p.`id` = ? AND p.`user_id` = ?', [$id, $userId]);
    }

    public function countOf(int $userId): int
    {
        return (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('player_tokens') . ' WHERE `user_id` = ?', [$userId]);
    }

    public function insert(int $userId, string $name, ?int $assetId, ?int $sourceAssetId, string $design): int
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('player_tokens') . ' (`user_id`, `name`, `asset_id`, `source_asset_id`, `design`, `created_at`, `updated_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$userId, $name, $assetId, $sourceAssetId, $design, $now, $now],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $changes among name, asset_id, source_asset_id, design
     */
    public function update(int $id, array $changes): void
    {
        $sets = [];
        $params = [];
        foreach (['name', 'asset_id', 'source_asset_id', 'design'] as $column) {
            if (array_key_exists($column, $changes)) {
                $sets[] = '`' . $column . '` = ?';
                $params[] = $changes[$column];
            }
        }
        $sets[] = '`updated_at` = ?';
        $params[] = $this->clock->sql();
        $params[] = $id;
        $this->db->execute('UPDATE ' . $this->db->t('player_tokens') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
    }

    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('player_tokens') . ' WHERE `id` = ?', [$id]);
    }

    public function deleteAllOf(int $userId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('player_tokens') . ' WHERE `user_id` = ?', [$userId]);
    }

    /**
     * Names of the live games where the token is the member's choice.
     *
     * @return list<string>
     */
    public function gamesUsing(int $id): array
    {
        $rows = $this->db->fetchAll(
            'SELECT g.`name` FROM ' . $this->db->t('game_token_choices') . ' c INNER JOIN ' . $this->db->t('games')
            . ' g ON g.`id` = c.`game_id` WHERE c.`player_token_id` = ? AND g.`deleted_at` IS NULL ORDER BY g.`id` LIMIT 50',
            [$id],
        );

        return array_map(static fn (array $r): string => (string) $r['name'], $rows);
    }

    /**
     * Is the asset still the image or the source portrait of a token of the collection?
     */
    public function assetReferenced(int $assetId): bool
    {
        return $this->db->fetchValue(
            'SELECT 1 FROM ' . $this->db->t('player_tokens') . ' WHERE `asset_id` = ? OR `source_asset_id` = ? LIMIT 1',
            [$assetId, $assetId],
        ) !== null;
    }

    /**
     * Id of the token chosen by the member for the game, or null.
     */
    public function choiceOf(int $gameId, int $userId): ?int
    {
        $v = $this->db->fetchValue(
            'SELECT `player_token_id` FROM ' . $this->db->t('game_token_choices') . ' WHERE `game_id` = ? AND `user_id` = ?',
            [$gameId, $userId],
        );

        return $v === null ? null : (int) $v;
    }

    public function setChoice(int $gameId, int $userId, ?int $playerTokenId): void
    {
        if ($playerTokenId === null) {
            $this->db->execute(
                'DELETE FROM ' . $this->db->t('game_token_choices') . ' WHERE `game_id` = ? AND `user_id` = ?',
                [$gameId, $userId],
            );

            return;
        }
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('game_token_choices') . ' (`game_id`, `user_id`, `player_token_id`, `updated_at`) VALUES (?, ?, ?, ?) '
            . 'ON DUPLICATE KEY UPDATE `player_token_id` = VALUES(`player_token_id`), `updated_at` = VALUES(`updated_at`)',
            [$gameId, $userId, $playerTokenId, $this->clock->sql()],
        );
    }

    /**
     * A member leaves a game: their choice goes with them.
     */
    public function clearChoice(int $gameId, int $userId): void
    {
        $this->setChoice($gameId, $userId, null);
    }

    public function sessionInProgress(int $gameId): bool
    {
        return $this->db->fetchValue(
            'SELECT 1 FROM ' . $this->db->t('play_sessions') . " WHERE `game_id` = ? AND `state` IN ('running', 'paused') LIMIT 1",
            [$gameId],
        ) !== null;
    }

    private function select(): string
    {
        return 'SELECT p.*, a.`uuid` AS asset_uuid, a.`deleted_at` AS asset_deleted_at, s.`uuid` AS source_uuid, '
            . 's.`deleted_at` AS source_deleted_at, (SELECT COUNT(*) FROM ' . $this->db->t('game_token_choices')
            . ' c WHERE c.`player_token_id` = p.`id`) AS games_count FROM ' . $this->db->t('player_tokens') . ' p '
            . 'LEFT JOIN ' . $this->db->t('assets') . ' a ON a.`id` = p.`asset_id` '
            . 'LEFT JOIN ' . $this->db->t('assets') . ' s ON s.`id` = p.`source_asset_id`';
    }
}
