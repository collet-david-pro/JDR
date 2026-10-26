<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\Dates;
use JDR\Realtime\EventReader;

/**
 * API representation "Session" (contract P6 "Objet séance"). The code is only given to the GM /
 * co-GMs; a player does not see the kicked players. last_event_id is the head of the event log
 * read before the state (a response written in a transaction therefore precedes its own events:
 * a client that subscribes from it receives them again, tagged with its client_op_id).
 */
final class SessionPresenter
{
    public function __construct(private SessionRepository $sessions, private EventReader $reader)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function one(SessionContext $ctx, ?int $head = null): array
    {
        return $this->many([$ctx->session], $ctx, $head)[0];
    }

    /**
     * Sessions of one game seen by the same user ($view gives the role and the settings).
     *
     * @param list<Session> $sessions
     * @return list<array<string, mixed>>
     */
    public function many(array $sessions, SessionContext $view, ?int $head = null): array
    {
        $head ??= $this->reader->headId();
        $ids = array_map(static fn (Session $s): int => $s->id, $sessions);
        $players = $this->sessions->playersOf($ids);
        $assignments = $this->sessions->assignmentsOf($ids);
        $out = [];
        foreach ($sessions as $s) {
            $list = $players[$s->id] ?? [];
            if (!$view->isGm()) {
                $list = array_values(array_filter($list, static fn (array $p): bool => $p['status'] !== 'kicked'));
            }
            $row = [
                'id' => $s->id,
                'game_id' => $s->gameId,
                'name' => $s->name,
            ];
            if ($view->isGm()) {
                $row['code'] = $s->code;
            }
            $out[] = $row + [
                'state' => $s->state,
                'current_map_id' => $s->currentMapId,
                'current_floor_id' => $s->currentFloorId,
                'camera' => $s->camera,
                'pause_screen' => $s->pauseScreen,
                'created_at' => Dates::iso($s->createdAt),
                'started_at' => Dates::iso($s->startedAt),
                'ended_at' => Dates::iso($s->endedAt),
                'players' => $list,
                'assignments' => $assignments[$s->id] ?? [],
                'settings' => $view->publicSettings(),
                'role' => $view->role,
                'last_event_id' => $head,
            ];
        }

        return $out;
    }
}
