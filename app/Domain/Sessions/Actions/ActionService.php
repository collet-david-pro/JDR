<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Sessions\EventFanout;
use JDR\Domain\Sessions\Session;
use JDR\Domain\Sessions\SessionAccess;
use JDR\Domain\Sessions\SessionContext;
use JDR\Domain\Sessions\SessionOps;
use JDR\Domain\Sessions\SessionRepository;
use JDR\Domain\Users\User;
use JDR\Realtime\EventReader;
use JDR\Realtime\EventStore;

/**
 * POST /sessions/{id}/actions {client_op_id?, actions: [1-20]} (projet.md 10.5, contract P6
 * "Actions de séance"):
 * 1. rights (SessionAccess: 404 / 403), validation of every action (422 actions.<i>.<key>), GM
 *    only actions refused to a player (403);
 * 2. one transaction (SessionOps::once: a replayed client_op_id returns the stored results):
 *    session row locked (state: a player needs "running" - 409 session_paused /
 *    session_not_running -, the GM "running" or "paused"), current map row locked (serializes
 *    with POST /maps/{id}/ops: lock order session -> map -> event_seq), every action checked
 *    against the map (ActionScene: 422 / 403) before the first one is applied;
 * 3. actions applied in order (ActionHandlers), events written by FanoutBatch;
 * 4. response {results, last_event_id}: last_event_id is read after COMMIT (the last event of
 *    the batch, or the head of the log when it wrote none).
 */
final class ActionService
{
    public function __construct(
        private SessionAccess $access,
        private SessionOps $ops,
        private SessionRepository $sessions,
        private MapRepository $maps,
        private MapSceneRepository $scene,
        private ActionHandlers $handlers,
        private EventFanout $fanout,
        private EventStore $store,
        private EventReader $reader,
    ) {
    }

    /**
     * @param array<array-key, mixed> $body
     * @return array{results: list<array<string, mixed>>, last_event_id: string}
     */
    public function apply(User $user, int $sessionId, array $body): array
    {
        $ctx = $this->access->resolve($user, $sessionId);
        $opId = SessionOps::clientOpId($body);
        $actions = ActionInput::parse($body);
        if (!$ctx->isGm()) {
            foreach ($actions as $a) {
                if (!in_array($a['type'], ActionInput::PLAYER_TYPES, true)) {
                    throw new ForbiddenException();
                }
            }
        }
        $before = $this->store->lastCommittedId();
        $data = $this->ops->once($user, $opId, 'actions:' . $sessionId, function () use ($user, $ctx, $sessionId, $actions, $opId): array {
            $session = $this->sessions->findForUpdate($sessionId) ?? throw new NotFoundException();
            self::requireState($session, $ctx->isGm());
            $ctx = new SessionContext($session, $ctx->gmUserId, $ctx->gameSettings, $ctx->role);
            $map = $session->currentMapId === null ? null : $this->maps->findForUpdate($session->currentMapId);
            if ($map === null || $map->deletedAt !== null) {
                throw new ValidationException('', ['current_map_id' => 'not_found']);
            }
            $assignments = [];
            foreach ($this->sessions->assignmentsOf([$session->id])[$session->id] ?? [] as $row) {
                $assignments[$row['token_id']] = $row['user_id'];
            }
            $scene = new ActionScene($ctx, $map, $this->maps->floors($map->id), $user->id, $assignments, $this->scene, $this->sessions->db());
            $scene->resolve($actions);
            $batch = $this->fanout->begin($ctx, $map, $user->id, $opId);
            $results = [];
            foreach ($actions as $i => $a) {
                $results[] = $this->handlers->apply($scene, $batch, $a, $i);
            }

            return ['results' => $results];
        });
        $after = $this->store->lastCommittedId();
        $last = $after !== null && $after !== $before ? $after : $this->reader->headId();

        return ['results' => is_array($data['results'] ?? null) ? $data['results'] : [], 'last_event_id' => (string) $last];
    }

    /**
     * @throws ConflictException session_paused | session_not_running
     */
    private static function requireState(Session $session, bool $gm): void
    {
        if ($session->state === Session::RUNNING || ($gm && $session->state === Session::PAUSED)) {
            return;
        }
        $code = $session->state === Session::PAUSED ? 'session_paused' : 'session_not_running';

        throw new ConflictException('', ['state' => $session->state], $code);
    }
}
