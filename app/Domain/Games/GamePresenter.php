<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Support\Dates;

/**
 * API representations "Game" and "Member" (contract P3). Only call for a game the viewer may see.
 */
final class GamePresenter
{
    public function __construct(private AssetUrls $urls)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function game(Game $game, string $apiBase): array
    {
        return [
            'id' => $game->id,
            'name' => $game->name,
            'description' => $game->description,
            'cover_asset_id' => $game->coverAssetId,
            'cover_url' => $game->coverUuid === null ? null : $this->urls->url($apiBase, $game->coverUuid, 'thumb'),
            'gm' => ['id' => $game->gmUserId, 'username' => $game->gmUsername],
            'my_role' => $game->role,
            'settings' => $game->settings,
            'counts' => ['maps' => $game->mapCount, 'tokens' => $game->tokenCount, 'members' => $game->memberCount],
            'archived_at' => Dates::iso($game->archivedAt),
            'deleted_at' => Dates::iso($game->deletedAt),
            'created_at' => Dates::iso($game->createdAt),
            'updated_at' => Dates::iso($game->updatedAt),
        ];
    }

    /**
     * @param list<Game> $games
     * @return list<array<string, mixed>>
     */
    public function games(array $games, string $apiBase): array
    {
        return array_map(fn (Game $g): array => $this->game($g, $apiBase), $games);
    }

    /**
     * @param array{user_id: int, username: string, role: string, joined_at: string} $member
     * @return array<string, mixed>
     */
    public static function member(array $member): array
    {
        return [
            'user' => ['id' => $member['user_id'], 'username' => $member['username']],
            'role' => $member['role'],
            'joined_at' => Dates::iso($member['joined_at']),
        ];
    }

    /**
     * The GM first (role "gm", joined when the game was created), then the members.
     *
     * @param list<array{user_id: int, username: string, role: string, joined_at: string}> $members
     * @return list<array<string, mixed>>
     */
    public static function members(Game $game, array $members): array
    {
        $out = [self::member([
            'user_id' => $game->gmUserId,
            'username' => $game->gmUsername,
            'role' => Game::ROLE_GM,
            'joined_at' => $game->createdAt,
        ])];
        foreach ($members as $member) {
            $out[] = self::member($member);
        }

        return $out;
    }
}
