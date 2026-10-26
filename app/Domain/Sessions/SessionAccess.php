<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Domain\Games\Game;
use JDR\Domain\Games\GameSettings;
use JDR\Domain\Users\User;

/**
 * Rights on a session (projet.md 11.2, contract P6 "Droits"), the same as the real-time channel:
 * - gm = GM or co-GM of the game: whole audience, every action;
 * - player = session_players row whose status is not "kicked";
 * - another member of the game, or a kicked player: 403;
 * - anyone else, an unknown session or a game in the trash: 404 (existence never revealed).
 */
final class SessionAccess
{
    public function __construct(private SessionRepository $sessions)
    {
    }

    /**
     * @throws NotFoundException|ForbiddenException
     */
    public function resolve(User $user, int $sessionId): SessionContext
    {
        $row = $this->sessions->accessRow($sessionId, $user->id);
        if ($row === null || $row['game_deleted_at'] !== null) {
            throw new NotFoundException();
        }
        $session = Session::fromRow($row);
        $gmId = (int) $row['gm_user_id'];
        $settings = GameSettings::fromJson($row['game_settings'] === null ? null : (string) $row['game_settings']);
        if ($gmId === $user->id || $row['member_role'] === Game::ROLE_CO_GM) {
            return new SessionContext($session, $gmId, $settings, SessionContext::GM);
        }
        $status = $row['player_status'];
        if ($status !== null && $status !== 'kicked') {
            return new SessionContext($session, $gmId, $settings, SessionContext::PLAYER);
        }
        if ($status !== null || $row['member_role'] !== null) {
            throw new ForbiddenException();
        }

        throw new NotFoundException();
    }

    /**
     * @throws NotFoundException|ForbiddenException a player gets 403
     */
    public function requireGm(User $user, int $sessionId): SessionContext
    {
        $ctx = $this->resolve($user, $sessionId);
        if (!$ctx->isGm()) {
            throw new ForbiddenException();
        }

        return $ctx;
    }

    /**
     * @throws NotFoundException|ForbiddenException the GM and co-GMs get 403 (players only)
     */
    public function requirePlayer(User $user, int $sessionId): SessionContext
    {
        $ctx = $this->resolve($user, $sessionId);
        if ($ctx->isGm()) {
            throw new ForbiddenException();
        }

        return $ctx;
    }
}
