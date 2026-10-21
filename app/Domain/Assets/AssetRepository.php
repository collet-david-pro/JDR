<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to assets, asset_tag_map, asset_favorites and the usage tables.
 */
final class AssetRepository
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function find(int $id): ?Asset
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [$id]);

        return $row === null ? null : Asset::fromRow($row);
    }

    public function findByUuid(string $uuid): ?Asset
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('assets') . ' WHERE `uuid` = ?', [$uuid]);

        return $row === null ? null : Asset::fromRow($row);
    }

    /**
     * Live asset of this owner (null = general library) with this content.
     */
    public function findDuplicate(?int $ownerId, string $sha256): ?Asset
    {
        $row = $this->db->fetchOne(
            'SELECT * FROM ' . $this->db->t('assets') . ' WHERE '
            . ($ownerId === null ? '`owner_user_id` IS NULL' : '`owner_user_id` = ?')
            . ' AND `sha256` = ? AND `deleted_at` IS NULL ORDER BY `id` LIMIT 1',
            $ownerId === null ? [$sha256] : [$ownerId, $sha256],
        );

        return $row === null ? null : Asset::fromRow($row);
    }

    /**
     * @param array<string, mixed> $fields column => value
     */
    public function insert(array $fields): int
    {
        $now = $this->clock->sql();
        $fields += ['created_at' => $now, 'updated_at' => $now];
        $columns = array_keys($fields);
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('assets') . ' (`' . implode('`, `', $columns) . '`) VALUES ('
            . implode(', ', array_fill(0, count($columns), '?')) . ')',
            array_values($fields),
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $fields among name, kind, category_id
     */
    public function update(int $id, array $fields): void
    {
        $allowed = array_intersect_key($fields, array_flip(['name', 'kind', 'category_id']));
        if ($allowed === []) {
            return;
        }
        $sets = [];
        foreach (array_keys($allowed) as $column) {
            $sets[] = '`' . $column . '` = ?';
        }
        $this->db->execute(
            'UPDATE ' . $this->db->t('assets') . ' SET ' . implode(', ', $sets) . ', `updated_at` = ? WHERE `id` = ?',
            [...array_values($allowed), $this->clock->sql(), $id],
        );
    }

    /**
     * Soft delete; false when already deleted.
     */
    public function softDelete(int $id): bool
    {
        $now = $this->clock->sql();

        return $this->db->execute(
            'UPDATE ' . $this->db->t('assets') . ' SET `deleted_at` = ?, `updated_at` = ? WHERE `id` = ? AND `deleted_at` IS NULL',
            [$now, $now, $id],
        ) === 1;
    }

    public function hardDelete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Library page, newest first. Filters: scope ("mine" | "general" | "game" with asset_ids), kind, q (name contains),
     * tag_ids (any of), category_id, favorites (of $userId). Cursor = id of the last item.
     *
     * @param array{scope: string, asset_ids?: list<int>, kind?: ?string, q?: ?string, tag_ids?: ?list<int>, category_id?: ?int, favorites?: bool} $filters
     * @return array{items: list<Asset>, next_cursor: ?string}
     */
    public function page(int $userId, array $filters, ?int $cursor, int $limit): array
    {
        $a = $this->db->t('assets');
        $sql = 'SELECT a.* FROM ' . $a . ' a';
        $where = ['a.`deleted_at` IS NULL'];
        $params = [];
        if (($filters['favorites'] ?? false) === true) {
            $sql .= ' INNER JOIN ' . $this->db->t('asset_favorites') . ' f ON f.`asset_id` = a.`id` AND f.`user_id` = ?';
            $params[] = $userId;
        }
        if ($filters['scope'] === 'general') {
            $where[] = 'a.`owner_user_id` IS NULL';
        } elseif ($filters['scope'] === 'game') {
            // Ids computed by gameAssetIds() for this viewer (rights already applied).
            $gameIds = $filters['asset_ids'] ?? [];
            if ($gameIds === []) {
                return ['items' => [], 'next_cursor' => null];
            }
            $where[] = 'a.`id` IN (' . implode(', ', array_fill(0, count($gameIds), '?')) . ')';
            array_push($params, ...$gameIds);
        } else {
            $where[] = 'a.`owner_user_id` = ?';
            $params[] = $userId;
        }
        if (($filters['kind'] ?? null) !== null) {
            $where[] = 'a.`kind` = ?';
            $params[] = $filters['kind'];
        }
        if (($filters['q'] ?? null) !== null) {
            $where[] = "a.`name` LIKE ? ESCAPE '!'";
            $params[] = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], (string) $filters['q']) . '%';
        }
        if (($filters['category_id'] ?? null) !== null) {
            $where[] = 'a.`category_id` = ?';
            $params[] = $filters['category_id'];
        }
        $tagIds = $filters['tag_ids'] ?? null;
        if ($tagIds !== null) {
            if ($tagIds === []) {
                return ['items' => [], 'next_cursor' => null];
            }
            $where[] = 'EXISTS (SELECT 1 FROM ' . $this->db->t('asset_tag_map') . ' m WHERE m.`asset_id` = a.`id` AND m.`tag_id` IN ('
                . implode(', ', array_fill(0, count($tagIds), '?')) . '))';
            array_push($params, ...$tagIds);
        }
        if ($cursor !== null) {
            $where[] = 'a.`id` < ?';
            $params[] = $cursor;
        }
        $params[] = $limit + 1;
        $rows = $this->db->fetchAll($sql . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY a.`id` DESC LIMIT ?', $params);
        $next = null;
        if (count($rows) > $limit) {
            array_pop($rows);
            $next = (string) $rows[count($rows) - 1]['id'];
        }

        return ['items' => array_map(static fn (array $r): Asset => Asset::fromRow($r), $rows), 'next_cursor' => $next];
    }

    /**
     * @param list<int> $assetIds
     * @return array<int, list<array{id: int, name: string}>>
     */
    public function tagsFor(array $assetIds): array
    {
        if ($assetIds === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT m.`asset_id`, t.`id`, t.`name` FROM ' . $this->db->t('asset_tag_map') . ' m INNER JOIN '
            . $this->db->t('asset_tags') . ' t ON t.`id` = m.`tag_id` WHERE m.`asset_id` IN ('
            . implode(', ', array_fill(0, count($assetIds), '?')) . ') ORDER BY t.`name`',
            $assetIds,
        );
        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['asset_id']][] = ['id' => (int) $row['id'], 'name' => (string) $row['name']];
        }

        return $out;
    }

    /**
     * @param list<int> $tagIds
     */
    public function setTags(int $assetId, array $tagIds): void
    {
        $map = $this->db->t('asset_tag_map');
        $this->db->execute('DELETE FROM ' . $map . ' WHERE `asset_id` = ?', [$assetId]);
        foreach (array_unique($tagIds) as $tagId) {
            $this->db->execute('INSERT IGNORE INTO ' . $map . ' (`asset_id`, `tag_id`) VALUES (?, ?)', [$assetId, $tagId]);
        }
    }

    /**
     * @param list<int> $assetIds
     * @return array<int, true>
     */
    public function favoritesOf(int $userId, array $assetIds): array
    {
        if ($assetIds === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT `asset_id` FROM ' . $this->db->t('asset_favorites') . ' WHERE `user_id` = ? AND `asset_id` IN ('
            . implode(', ', array_fill(0, count($assetIds), '?')) . ')',
            [$userId, ...$assetIds],
        );
        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['asset_id']] = true;
        }

        return $out;
    }

    public function setFavorite(int $userId, int $assetId, bool $favorite): void
    {
        $table = $this->db->t('asset_favorites');
        if ($favorite) {
            $this->db->execute('INSERT IGNORE INTO ' . $table . ' (`user_id`, `asset_id`) VALUES (?, ?)', [$userId, $assetId]);
        } else {
            $this->db->execute('DELETE FROM ' . $table . ' WHERE `user_id` = ? AND `asset_id` = ?', [$userId, $assetId]);
        }
    }

    /**
     * Maps (map_asset_refs) and token definitions (tokens.asset_id) using the asset.
     * Names of maps / games the viewer does not own are hidden (privacy, projet.md 11.2 note).
     *
     * @return array{maps: list<array{id: int, name: ?string}>, tokens: list<array{id: int, name: ?string}>}
     */
    public function usages(int $assetId, int $viewerId): array
    {
        $maps = $this->db->fetchAll(
            'SELECT m.`id`, m.`name`, m.`owner_user_id` FROM ' . $this->db->t('map_asset_refs') . ' r INNER JOIN '
            . $this->db->t('maps') . ' m ON m.`id` = r.`map_id` WHERE r.`asset_id` = ? AND r.`ref_count` > 0 '
            . 'AND m.`deleted_at` IS NULL ORDER BY m.`id`',
            [$assetId],
        );
        $tokens = $this->db->fetchAll(
            'SELECT t.`id`, t.`name`, g.`gm_user_id` FROM ' . $this->db->t('tokens') . ' t INNER JOIN '
            . $this->db->t('games') . ' g ON g.`id` = t.`game_id` WHERE t.`asset_id` = ? AND t.`deleted_at` IS NULL '
            . 'AND g.`deleted_at` IS NULL ORDER BY t.`id`',
            [$assetId],
        );

        return [
            'maps' => array_map(static fn (array $r): array => [
                'id' => (int) $r['id'],
                'name' => (int) $r['owner_user_id'] === $viewerId ? (string) $r['name'] : null,
            ], $maps),
            'tokens' => array_map(static fn (array $r): array => [
                'id' => (int) $r['id'],
                'name' => (int) $r['gm_user_id'] === $viewerId ? (string) $r['name'] : null,
            ], $tokens),
        ];
    }

    /**
     * Assets used by a game (projet.md 9.3, contract P3 / D8), whatever their owner:
     * $playerId null (GM, co-GM) => cover + images of the live tokens + assets of the live maps
     * (map_asset_refs); $playerId set (player) => cover + images of the tokens they own by default.
     *
     * @return list<int>
     */
    public function gameAssetIds(int $gameId, ?int $playerId): array
    {
        $tokens = 'SELECT t.`asset_id` FROM ' . $this->db->t('tokens') . ' t WHERE t.`game_id` = ? '
            . 'AND t.`deleted_at` IS NULL AND t.`asset_id` IS NOT NULL';
        $params = [$gameId, $gameId];
        if ($playerId !== null) {
            $tokens .= ' AND t.`default_owner_user_id` = ?';
            $params[] = $playerId;
        }
        $sql = 'SELECT g.`cover_asset_id` AS asset_id FROM ' . $this->db->t('games') . ' g WHERE g.`id` = ? '
            . 'AND g.`cover_asset_id` IS NOT NULL UNION ' . $tokens;
        if ($playerId === null) {
            $sql .= ' UNION SELECT r.`asset_id` FROM ' . $this->db->t('map_asset_refs') . ' r INNER JOIN '
                . $this->db->t('maps') . ' m ON m.`id` = r.`map_id` WHERE m.`game_id` = ? AND m.`deleted_at` IS NULL '
                . 'AND r.`ref_count` > 0';
            $params[] = $gameId;
        }
        $rows = $this->db->fetchAll($sql, $params);

        return array_values(array_unique(array_map(static fn (array $r): int => (int) $r['asset_id'], $rows)));
    }

    /**
     * True when $userId may see the asset through a live game (same rules as gameAssetIds()):
     * cover of a game they belong to, image of a token of a game they run / co-run or of a token
     * they own by default, asset of a live map of a game they run / co-run.
     */
    public function visibleThroughGames(int $assetId, int $userId): bool
    {
        $g = $this->db->t('games');
        $gm = $this->db->t('game_members');
        $member = 'EXISTS (SELECT 1 FROM ' . $gm . ' x WHERE x.`game_id` = g.`id` AND x.`user_id` = ?)';
        $editor = '(g.`gm_user_id` = ? OR EXISTS (SELECT 1 FROM ' . $gm . " x WHERE x.`game_id` = g.`id` AND x.`user_id` = ? AND x.`role` = 'co_gm'))";
        $sql = 'SELECT 1 FROM ' . $g . ' g WHERE g.`deleted_at` IS NULL AND ('
            . '(g.`cover_asset_id` = ? AND (g.`gm_user_id` = ? OR ' . $member . '))'
            . ' OR EXISTS (SELECT 1 FROM ' . $this->db->t('tokens') . ' t WHERE t.`game_id` = g.`id` AND t.`asset_id` = ? '
            . 'AND t.`deleted_at` IS NULL AND (' . $editor . ' OR (t.`default_owner_user_id` = ? AND ' . $member . ')))'
            . ' OR (' . $editor . ' AND EXISTS (SELECT 1 FROM ' . $this->db->t('map_asset_refs') . ' r INNER JOIN '
            . $this->db->t('maps') . ' m ON m.`id` = r.`map_id` WHERE m.`game_id` = g.`id` AND m.`deleted_at` IS NULL '
            . 'AND r.`asset_id` = ? AND r.`ref_count` > 0))'
            . ') LIMIT 1';
        $params = [
            $assetId, $userId, $userId,
            $assetId, $userId, $userId, $userId, $userId,
            $userId, $userId, $assetId,
        ];

        return $this->db->fetchValue($sql, $params) !== null;
    }

    /**
     * Soft-deleted assets whose trash delay is over.
     *
     * @return list<Asset>
     */
    public function expiredTrash(string $before, int $limit): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . $this->db->t('assets') . ' WHERE `deleted_at` IS NOT NULL AND `deleted_at` < ? ORDER BY `id` LIMIT ?',
            [$before, $limit],
        );

        return array_map(static fn (array $r): Asset => Asset::fromRow($r), $rows);
    }

    /**
     * @return list<Asset>
     */
    public function liveOfOwner(int $ownerId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . $this->db->t('assets') . ' WHERE `owner_user_id` = ? AND `deleted_at` IS NULL ORDER BY `id`',
            [$ownerId],
        );

        return array_map(static fn (array $r): Asset => Asset::fromRow($r), $rows);
    }

    /**
     * Ids of the live assets visible to $userId (own + general) among $ids, or in $categoryId,
     * or (both null) every own personal asset.
     *
     * @param list<int>|null $ids
     * @return list<int>
     */
    public function visibleIds(int $userId, ?array $ids, ?int $categoryId, int $limit): array
    {
        $where = ['`deleted_at` IS NULL'];
        $params = [];
        if ($ids === null && $categoryId === null) {
            $where[] = '`owner_user_id` = ?';
            $params[] = $userId;
        } else {
            $where[] = '(`owner_user_id` = ? OR `owner_user_id` IS NULL)';
            $params[] = $userId;
        }
        if ($ids !== null) {
            if ($ids === []) {
                return [];
            }
            $where[] = '`id` IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')';
            array_push($params, ...$ids);
        }
        if ($categoryId !== null) {
            $where[] = '`category_id` = ?';
            $params[] = $categoryId;
        }
        $params[] = $limit;
        $rows = $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('assets') . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY `id` LIMIT ?',
            $params,
        );

        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }
}
