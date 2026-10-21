<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Domain\Users\User;

/**
 * Rights on a game (projet.md 11.2):
 * - view: GM, co-GM or player member;
 * - edit (maps, tokens, encounters, sessions): GM or co-GM;
 * - manage (game itself, members, archive, trash): GM only.
 * A non-member gets 404 (existence never revealed, admins included: privacy), a member without
 * the right gets 403. A game in the trash exists only for its GM, and only for the routes that
 * act on the trash (show, delete, restore).
 */
final class GamePolicy
{
    public function __construct(private GameRepository $games)
    {
    }

    public function canView(User $user, Game $game): bool
    {
        if ($game->gmUserId === $user->id) {
            return true;
        }
        $isMember = $game->role === Game::ROLE_PLAYER || $game->role === Game::ROLE_CO_GM;

        return $isMember && $game->deletedAt === null;
    }

    public function canEdit(User $user, Game $game): bool
    {
        return $this->canView($user, $game) && $game->deletedAt === null && $game->isEditor();
    }

    public function canManage(User $user, Game $game): bool
    {
        return $this->canView($user, $game) && $game->gmUserId === $user->id;
    }

    /**
     * @throws NotFoundException
     */
    public function requireView(User $user, int $gameId, bool $allowTrash = false): Game
    {
        $game = $this->games->find($gameId, $user->id);
        if ($game === null || !$this->canView($user, $game) || ($game->deletedAt !== null && !$allowTrash)) {
            throw new NotFoundException();
        }

        return $game;
    }

    /**
     * @throws NotFoundException|ForbiddenException
     */
    public function requireEdit(User $user, int $gameId): Game
    {
        $game = $this->requireView($user, $gameId);
        if (!$this->canEdit($user, $game)) {
            throw new ForbiddenException();
        }

        return $game;
    }

    /**
     * @throws NotFoundException|ForbiddenException
     */
    public function requireManage(User $user, int $gameId, bool $allowTrash = false): Game
    {
        $game = $this->requireView($user, $gameId, $allowTrash);
        if (!$this->canManage($user, $game)) {
            throw new ForbiddenException();
        }

        return $game;
    }
}
