<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Assets\AssetPolicy;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Users\User;

/**
 * Life cycle of a session (projet.md 2.3, 11.5, contract P6 "Endpoints séances"): creation
 * (one open session per game, D7 pre-assignments), list, rename / pause screen, transitions
 * (lobby -> running <-> paused, anything -> ended), code regeneration, change of map. Every write
 * accepts a client_op_id (SessionOps) and writes its events in its transaction.
 * Rights: SessionAccess (GM / co-GM for every write; player 403; non-member 404).
 */
final class SessionService
{
    public const LIST_DEFAULT = 50;
    public const LIST_MAX = 200;

    public function __construct(
        private SessionRepository $sessions,
        private SessionAccess $access,
        private SessionOps $ops,
        private SessionEvents $events,
        private SessionPresenter $presenter,
        private GamePolicy $games,
        private MapRepository $maps,
        private AssetRepository $assets,
        private AssetPolicy $assetPolicy,
        private CodeGenerator $codes,
        private Clock $clock,
    ) {
    }

    /**
     * @param array<array-key, mixed> $body {name?, map_id?, floor_id?, client_op_id?}
     * @return array<string, mixed> Session (role gm)
     */
    public function create(User $user, int $gameId, array $body): array
    {
        $game = $this->games->requireEdit($user, $gameId);
        $v = SessionInput::create($body);
        $opId = SessionOps::clientOpId($body);

        return $this->ops->once($user, $opId, 'create:' . $game->id, function () use ($user, $game, $v, $opId): array {
            $this->sessions->lockGame($game->id);
            $open = $this->sessions->openSessionId($game->id);
            if ($open !== null) {
                throw new ConflictException('', ['session_id' => (string) $open], 'session_exists');
            }
            [$mapId, $floorId] = $v['map_id'] === null ? [null, null] : $this->mapAndFloor($game->id, $v['map_id'], $v['floor_id']);
            $code = $this->codes->generate($this->sessions->codeExists(...));
            $id = $this->sessions->insert($game->id, $code, $v['name'], $mapId, $floorId, $user->id);
            foreach ($this->sessions->defaultOwners($game->id) as $a) {
                $this->sessions->setAssignment($id, $a['token_id'], $a['user_id']);
                $this->events->assignment($id, $a['token_id'], $a['user_id'], $user->id, $opId);
            }
            $session = $this->sessions->find($id) ?? throw new \RuntimeException('Session lost after insert.');
            $this->events->state($session, $user->id, $opId);

            return $this->presenter->one($this->access->resolve($user, $id));
        });
    }

    /**
     * GET /games/{id}/sessions: the GM and co-GMs see every session, a player those he figures in.
     *
     * @param array<string, mixed> $query cursor (id of the last session of the previous page), limit
     * @return array{0: list<array<string, mixed>>, 1: ?string} [sessions, next cursor]
     */
    public function list(User $user, int $gameId, array $query): array
    {
        $game = $this->games->requireView($user, $gameId);
        $limit = $this->limit($query['limit'] ?? null);
        $cursor = $this->cursor($query['cursor'] ?? null);
        $rows = $this->sessions->listForGame($game->id, $game->isEditor() ? null : $user->id, $cursor, $limit + 1);
        $next = null;
        if (count($rows) > $limit) {
            $rows = array_slice($rows, 0, $limit);
            $next = (string) $rows[$limit - 1]->id;
        }
        if ($rows === []) {
            return [[], null];
        }
        $view = new SessionContext(
            $rows[0],
            $game->gmUserId,
            $game->settings,
            $game->isEditor() ? SessionContext::GM : SessionContext::PLAYER,
        );

        return [$this->presenter->many($rows, $view), $next];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(User $user, int $sessionId): array
    {
        return $this->presenter->one($this->access->resolve($user, $sessionId));
    }

    /**
     * @param array<array-key, mixed> $body {name?, pause_screen?, client_op_id?}
     * @return array<string, mixed>
     */
    public function update(User $user, int $sessionId, array $body): array
    {
        $ctx = $this->access->requireGm($user, $sessionId);
        $changes = SessionInput::patch($body);
        $opId = SessionOps::clientOpId($body);
        if (($changes['pause_screen']['asset_id'] ?? null) !== null) {
            $this->requirePauseAsset($user, $ctx, (int) $changes['pause_screen']['asset_id']);
        }

        return $this->ops->once($user, $opId, 'patch:' . $sessionId, function () use ($user, $sessionId, $changes, $opId): array {
            $locked = $this->lock($sessionId);
            if ($changes !== []) {
                $this->sessions->update($locked->id, $changes);
            }
            $session = $this->sessions->find($locked->id) ?? $locked;
            if (array_key_exists('pause_screen', $changes)) {
                $this->events->state($session, $user->id, $opId);
            }

            return $this->presenter->one($this->access->resolve($user, $sessionId));
        });
    }

    /**
     * start | pause | resume | end.
     *
     * @param array<array-key, mixed> $body {client_op_id?}
     * @return array<string, mixed>
     */
    public function transition(User $user, int $sessionId, string $action, array $body): array
    {
        $this->access->requireGm($user, $sessionId);
        $opId = SessionOps::clientOpId($body);

        return $this->ops->once($user, $opId, $action . ':' . $sessionId, function () use ($user, $sessionId, $action, $opId): array {
            $session = $this->lock($sessionId);
            $next = $session->next($action) ?? throw new ConflictException('', ['state' => $session->state], 'invalid_transition');
            $fields = ['state' => $next];
            if ($action === 'start') {
                $this->requireStartableMap($session);
                $fields['started_at'] = $this->clock->sql();
            } elseif ($action === 'end') {
                $fields['ended_at'] = $this->clock->sql();
            }
            $this->sessions->update($session->id, $fields);
            $this->events->state($this->sessions->find($session->id) ?? $session, $user->id, $opId);

            return $this->presenter->one($this->access->resolve($user, $sessionId));
        });
    }

    /**
     * @param array<array-key, mixed> $body {client_op_id?}
     * @return array{code: string}
     */
    public function regenerateCode(User $user, int $sessionId, array $body): array
    {
        $this->access->requireGm($user, $sessionId);
        $opId = SessionOps::clientOpId($body);

        return $this->ops->once($user, $opId, 'code:' . $sessionId, function () use ($user, $sessionId, $opId): array {
            $session = $this->lock($sessionId);
            $this->requireNotEnded($session);
            $code = $this->codes->generate($this->sessions->codeExists(...));
            $this->sessions->update($session->id, ['code' => $code]);
            $this->events->code($session->id, $code, $user->id, $opId);

            return ['code' => $code];
        });
    }

    /**
     * @param array<array-key, mixed> $body {map_id, floor_id?, client_op_id?}
     * @return array<string, mixed>
     */
    public function changeMap(User $user, int $sessionId, array $body): array
    {
        $ctx = $this->access->requireGm($user, $sessionId);
        $v = SessionInput::changeMap($body);
        $opId = SessionOps::clientOpId($body);

        return $this->ops->once($user, $opId, 'map:' . $sessionId, function () use ($user, $ctx, $sessionId, $v, $opId): array {
            $session = $this->lock($sessionId);
            $this->requireNotEnded($session);
            [$mapId, $floorId] = $this->mapAndFloor($ctx->session->gameId, $v['map_id'], $v['floor_id']);
            $this->sessions->update($session->id, ['current_map_id' => $mapId, 'current_floor_id' => $floorId]);
            $this->sessions->resetReady($session->id);
            $this->events->mapChanged($session->id, (int) $mapId, (int) $floorId, $user->id, $opId);

            return $this->presenter->one($this->access->resolve($user, $sessionId));
        });
    }

    /**
     * Map of the game (live) and one of its floors (the first one when $floorId is null).
     *
     * @return array{0: int, 1: int}
     * @throws ValidationException map_id / floor_id not_found
     */
    private function mapAndFloor(int $gameId, int $mapId, ?int $floorId): array
    {
        $map = $this->maps->find($mapId);
        if ($map === null || $map->gameId !== $gameId || $map->deletedAt !== null) {
            throw new ValidationException('', ['map_id' => 'not_found']);
        }
        $floors = $this->maps->floors($map->id);
        foreach ($floors as $floor) {
            if ($floorId === null || $floor['id'] === $floorId) {
                return [$map->id, $floor['id']];
            }
        }

        throw new ValidationException('', ['floor_id' => 'not_found']);
    }

    private function requireStartableMap(Session $session): void
    {
        if ($session->currentMapId === null) {
            throw new ValidationException('', ['current_map_id' => 'required']);
        }
        $map = $this->maps->find($session->currentMapId);
        if ($map === null || $map->deletedAt !== null) {
            throw new ValidationException('', ['current_map_id' => 'not_found']);
        }
    }

    private function requireNotEnded(Session $session): void
    {
        if ($session->isEnded()) {
            throw new ConflictException('', ['state' => $session->state], 'invalid_transition');
        }
    }

    private function requirePauseAsset(User $user, SessionContext $ctx, int $assetId): void
    {
        $asset = $this->assets->find($assetId);
        if ($asset === null || !$this->assetPolicy->canUseInGame($user, $asset, $ctx->session->gameId)) {
            throw new ValidationException('', ['pause_screen.asset_id' => 'not_found']);
        }
    }

    private function lock(int $sessionId): Session
    {
        return $this->sessions->findForUpdate($sessionId) ?? throw new NotFoundException();
    }

    private function limit(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return self::LIST_DEFAULT;
        }
        $n = is_string($raw) ? filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => self::LIST_MAX]]) : false;

        return $n === false ? throw new ValidationException('', ['limit' => 'invalid']) : $n;
    }

    private function cursor(mixed $raw): ?int
    {
        if ($raw === null || $raw === '') {
            return null;
        }

        return is_string($raw) && ctype_digit($raw) && strlen($raw) <= 18 && (int) $raw > 0
            ? (int) $raw
            : throw new ValidationException('', ['cursor' => 'invalid']);
    }
}
