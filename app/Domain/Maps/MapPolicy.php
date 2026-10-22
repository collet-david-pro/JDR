<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Domain\Games\Game;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Users\User;

/**
 * Rights on maps (projet.md 11.2, contract P4b): every map route is for the GM and co-GMs of
 * the game (GamePolicy::requireEdit); a player member gets 403, anyone else 404 (existence never
 * revealed). Maps outside a game (templates, P9) and maps in the trash (except for the trash
 * routes) are 404. Players will reach maps through sessions (P6, filtered).
 */
final class MapPolicy
{
    public function __construct(private MapRepository $maps, private GamePolicy $games)
    {
    }

    /**
     * @return array{0: Map, 1: Game}
     * @throws NotFoundException|ForbiddenException
     */
    public function requireEdit(User $user, int $mapId, bool $allowTrash = false): array
    {
        $map = $this->maps->find($mapId);
        if ($map === null || $map->gameId === null) {
            throw new NotFoundException();
        }
        $game = $this->games->requireEdit($user, $map->gameId);
        if ($map->deletedAt !== null && !$allowTrash) {
            throw new NotFoundException();
        }

        return [$map, $game];
    }
}
