<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

/**
 * A game seen by one user (row of games + GM username, cover, counts and the viewer's role).
 *
 * Membership model: the GM is games.gm_user_id and has NO game_members row; game_members only
 * holds the "player" and "co_gm" members. $role is the viewer's role (null = not a member).
 */
final class Game
{
    public const ROLE_GM = 'gm';
    public const ROLE_CO_GM = 'co_gm';
    public const ROLE_PLAYER = 'player';
    public const MEMBER_ROLES = [self::ROLE_PLAYER, self::ROLE_CO_GM];

    /**
     * @param array<string, mixed> $settings
     */
    public function __construct(
        public readonly int $id,
        public readonly int $gmUserId,
        public readonly string $gmUsername,
        public readonly string $name,
        public readonly ?string $description,
        public readonly ?int $coverAssetId,
        public readonly ?string $coverUuid,
        public readonly array $settings,
        public readonly ?string $archivedAt,
        public readonly string $createdAt,
        public readonly string $updatedAt,
        public readonly ?string $deletedAt,
        public readonly ?string $role,
        public readonly int $mapCount,
        public readonly int $tokenCount,
        public readonly int $memberCount,
    ) {
    }

    /**
     * @param array<string, mixed> $row columns of games + gm_username, member_role, cover_uuid,
     *                                  cover_deleted_at, count_maps, count_tokens, count_members
     */
    public static function fromRow(array $row, int $viewerId): self
    {
        $gmId = (int) $row['gm_user_id'];
        $role = $gmId === $viewerId ? self::ROLE_GM : ($row['member_role'] ?? null);
        $coverLive = $row['cover_asset_id'] !== null && ($row['cover_uuid'] ?? null) !== null
            && ($row['cover_deleted_at'] ?? null) === null;

        return new self(
            (int) $row['id'],
            $gmId,
            (string) ($row['gm_username'] ?? ''),
            (string) $row['name'],
            $row['description'] === null || $row['description'] === '' ? null : (string) $row['description'],
            $row['cover_asset_id'] === null ? null : (int) $row['cover_asset_id'],
            $coverLive ? (string) $row['cover_uuid'] : null,
            GameSettings::fromJson($row['settings'] === null ? null : (string) $row['settings']),
            $row['archived_at'] === null ? null : (string) $row['archived_at'],
            (string) $row['created_at'],
            (string) $row['updated_at'],
            $row['deleted_at'] === null ? null : (string) $row['deleted_at'],
            is_string($role) ? $role : null,
            (int) ($row['count_maps'] ?? 0),
            (int) ($row['count_tokens'] ?? 0),
            (int) ($row['count_members'] ?? 0),
        );
    }

    public function isDeleted(): bool
    {
        return $this->deletedAt !== null;
    }

    public function isGm(): bool
    {
        return $this->role === self::ROLE_GM;
    }

    /**
     * GM or co-GM: maps, tokens, encounters and sessions (projet.md 11.2).
     */
    public function isEditor(): bool
    {
        return $this->role === self::ROLE_GM || $this->role === self::ROLE_CO_GM;
    }
}
