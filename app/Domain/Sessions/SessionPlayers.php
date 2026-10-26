<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\GoneException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Game;
use JDR\Domain\Games\GameMemberRepository;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;

/**
 * The players of a session (projet.md 11.5, contract P6): join with a code, leave, kick,
 * ready flag and token assignments. Every write accepts a client_op_id (SessionOps) and writes
 * its events in its transaction (audiences: SessionEvents).
 */
final class SessionPlayers
{
    public function __construct(
        private SessionRepository $sessions,
        private SessionAccess $access,
        private SessionOps $ops,
        private SessionEvents $events,
        private GameMemberRepository $members,
        private TokenRepository $tokens,
    ) {
    }

    /**
     * POST /sessions/join {code}: creates game_members(player) if absent, then the session player
     * (or brings back a disconnected one). The GM and co-GMs just get the ids.
     *
     * @param array<array-key, mixed> $body {code, client_op_id?}
     * @return array{session_id: int, game_id: int}
     * @throws ValidationException|GoneException|ForbiddenException 422 session_code_invalid, 410 session_not_joinable, 403 kicked
     */
    public function join(User $user, array $body): array
    {
        $code = CodeGenerator::normalize($body['code'] ?? null);
        $opId = SessionOps::clientOpId($body);
        if ($code === null) {
            throw new ValidationException('', [], 'session_code_invalid');
        }

        return $this->ops->once($user, $opId, 'join:' . $code, function () use ($user, $code, $opId): array {
            $found = $this->sessions->findByCode($code);
            $session = $found === null ? null : $this->sessions->findForUpdate($found->id);
            $ctx = $session === null ? null : $this->gameOf($session, $user);
            if ($session === null || $ctx === null) {
                throw new ValidationException('', [], 'session_code_invalid');
            }
            if ($session->isEnded()) {
                throw new GoneException('', [], 'session_not_joinable');
            }
            $result = ['session_id' => $session->id, 'game_id' => $session->gameId];
            if ($ctx['is_gm']) {
                return $result;
            }
            $player = $this->sessions->player($session->id, $user->id, true);
            if ($player !== null && $player['status'] === 'kicked') {
                throw new ForbiddenException('', [], 'kicked');
            }
            if ($ctx['member_role'] === null) {
                $this->members->add($session->gameId, $user->id, Game::ROLE_PLAYER);
            }
            if ($player === null) {
                $this->sessions->insertPlayer($session->id, $user->id);
                $this->events->joined($session->id, $user->id, $user->username, $user->id, $opId);
            } elseif ($player['status'] !== 'connected') {
                $this->sessions->setPlayerStatus($session->id, $user->id, 'connected');
                $this->events->joined($session->id, $user->id, $user->username, $user->id, $opId);
            } else {
                $this->sessions->setPlayerStatus($session->id, $user->id, 'connected');
            }

            return $result;
        });
    }

    /**
     * POST /sessions/{id}/leave (a player): disconnected, ready flag cleared, assignments kept.
     *
     * @param array<array-key, mixed> $body
     */
    public function leave(User $user, int $sessionId, array $body): void
    {
        $this->access->requirePlayer($user, $sessionId);
        $opId = SessionOps::clientOpId($body);
        $this->ops->once($user, $opId, 'leave:' . $sessionId, function () use ($user, $sessionId, $opId): mixed {
            $this->requireSession($sessionId);
            $player = $this->sessions->player($sessionId, $user->id, true);
            if ($player !== null && $player['status'] === 'connected') {
                $this->sessions->setPlayerStatus($sessionId, $user->id, 'disconnected', false);
                $this->events->left($sessionId, $user->id, $player['username'], $user->id, $opId);
            }

            return null;
        });
    }

    /**
     * POST /sessions/{id}/ready {ready} (a player).
     *
     * @param array<array-key, mixed> $body
     */
    public function ready(User $user, int $sessionId, array $body): void
    {
        $this->access->requirePlayer($user, $sessionId);
        $ready = SessionInput::ready($body);
        $opId = SessionOps::clientOpId($body);
        $this->ops->once($user, $opId, 'ready:' . $sessionId, function () use ($user, $sessionId, $ready, $opId): mixed {
            $session = $this->requireSession($sessionId);
            $this->requireNotEnded($session);
            $player = $this->sessions->player($sessionId, $user->id, true);
            if ($player === null || $player['status'] === 'kicked') {
                throw new ForbiddenException();
            }
            if ($player['ready'] !== $ready) {
                $this->sessions->setReady($sessionId, $user->id, $ready);
                $this->events->ready($sessionId, $user->id, $ready, $user->id, $opId);
            }

            return null;
        });
    }

    /**
     * POST /sessions/{id}/kick {user_id} (GM): kicked, assignments removed.
     * Events: player.kicked (user), assignment.set x n, player.left.
     *
     * @param array<array-key, mixed> $body
     */
    public function kick(User $user, int $sessionId, array $body): void
    {
        $this->access->requireGm($user, $sessionId);
        $target = SessionInput::userId($body);
        $opId = SessionOps::clientOpId($body);
        $this->ops->once($user, $opId, 'kick:' . $sessionId, function () use ($user, $sessionId, $target, $opId): mixed {
            $session = $this->requireSession($sessionId);
            $this->requireNotEnded($session);
            $player = $this->sessions->player($sessionId, $target, true);
            if ($player === null) {
                throw new ValidationException('', ['user_id' => 'not_in_session']);
            }
            if ($player['status'] === 'kicked') {
                return null;
            }
            $this->sessions->setPlayerStatus($sessionId, $target, 'kicked', false);
            $freed = $this->sessions->removeUserAssignments($sessionId, $target);
            $this->events->kicked($sessionId, $target, $user->id, $opId);
            foreach ($freed as $tokenId) {
                $this->events->assignment($sessionId, $tokenId, null, $user->id, $opId);
            }
            $this->events->left($sessionId, $target, $player['username'], $user->id, $opId);

            return null;
        });
    }

    /**
     * PUT /sessions/{id}/assignments/{tokenId} {user_id | null} (GM).
     *
     * @param array<array-key, mixed> $body
     * @return array{token_id: int, user_id: int|null}
     */
    public function assign(User $user, int $sessionId, int $tokenId, array $body): array
    {
        $ctx = $this->access->requireGm($user, $sessionId);
        $assignee = SessionInput::assignee($body);
        $opId = SessionOps::clientOpId($body);
        if ($this->tokens->liveIdsInGame($ctx->session->gameId, [$tokenId]) === []) {
            throw new NotFoundException();
        }

        return $this->ops->once($user, $opId, 'assign:' . $sessionId . ':' . $tokenId, function () use ($user, $sessionId, $tokenId, $assignee, $opId): array {
            $session = $this->requireSession($sessionId);
            $this->requireNotEnded($session);
            if ($assignee !== null) {
                $player = $this->sessions->player($sessionId, $assignee);
                if ($player === null || $player['status'] === 'kicked') {
                    throw new ValidationException('', ['user_id' => 'not_in_session']);
                }
            }
            $current = $this->sessions->assignmentUser($sessionId, $tokenId);
            if ($current !== $assignee) {
                $assignee === null
                    ? $this->sessions->removeAssignment($sessionId, $tokenId)
                    : $this->sessions->setAssignment($sessionId, $tokenId, $assignee);
                $this->events->assignment($sessionId, $tokenId, $assignee, $user->id, $opId);
            }

            return ['token_id' => $tokenId, 'user_id' => $assignee];
        });
    }

    /**
     * @return array{is_gm: bool, member_role: ?string}|null null when the game is in the trash
     */
    private function gameOf(Session $session, User $user): ?array
    {
        $row = $this->sessions->accessRow($session->id, $user->id);
        if ($row === null || $row['game_deleted_at'] !== null) {
            return null;
        }

        return [
            'is_gm' => (int) $row['gm_user_id'] === $user->id || $row['member_role'] === Game::ROLE_CO_GM,
            'member_role' => $row['member_role'] === null ? null : (string) $row['member_role'],
        ];
    }

    private function requireSession(int $sessionId): Session
    {
        return $this->sessions->findForUpdate($sessionId) ?? throw new NotFoundException();
    }

    private function requireNotEnded(Session $session): void
    {
        if ($session->isEnded()) {
            throw new ConflictException('', ['state' => $session->state], 'invalid_transition');
        }
    }
}
