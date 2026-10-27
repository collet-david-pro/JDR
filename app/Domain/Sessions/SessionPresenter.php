<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetUrls;
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
    public function __construct(
        private SessionRepository $sessions,
        private EventReader $reader,
        private SessionSceneQueries $queries,
        private AssetUrls $urls,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function one(SessionContext $ctx, string $apiBase, ?int $head = null): array
    {
        return $this->many([$ctx->session], $ctx, $apiBase, $head)[0];
    }

    /**
     * pause_screen with the signed URL of its image.
     *
     * @param array<string, mixed>|null $pause {asset_id, text}
     * @param array<int, array{uuid: string, kind: string, bytes: int}>|null $assets live assets by id (read when null)
     * @return array<string, mixed>|null {asset_id, text, url}
     */
    public function pauseScreen(?array $pause, string $apiBase, ?array $assets = null): ?array
    {
        if ($pause === null) {
            return null;
        }
        $id = isset($pause['asset_id']) && is_numeric($pause['asset_id']) ? (int) $pause['asset_id'] : null;
        if ($id !== null && $assets === null) {
            $assets = $this->queries->assets([$id]);
        }
        $asset = $id === null ? null : ($assets[$id] ?? null);

        return $pause + ['url' => $asset === null ? null : $this->urls->url($apiBase, $asset['uuid'], 'full')];
    }

    /**
     * Sessions of one game seen by the same user ($view gives the role and the settings).
     *
     * @param list<Session> $sessions
     * @return list<array<string, mixed>>
     */
    public function many(array $sessions, SessionContext $view, string $apiBase, ?int $head = null): array
    {
        $head ??= $this->reader->headId();
        $ids = array_map(static fn (Session $s): int => $s->id, $sessions);
        $players = $view->isDisplay() ? [] : $this->sessions->playersOf($ids);
        $assignments = $this->sessions->assignmentsOf($ids);
        $pauseAssets = [];
        foreach ($sessions as $s) {
            if (is_numeric($s->pauseScreen['asset_id'] ?? null)) {
                $pauseAssets[] = (int) $s->pauseScreen['asset_id'];
            }
        }
        $pauseAssets = $pauseAssets === [] ? [] : $this->queries->assets($pauseAssets);
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
                'pause_screen' => $this->pauseScreen($s->pauseScreen, $apiBase, $pauseAssets),
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
