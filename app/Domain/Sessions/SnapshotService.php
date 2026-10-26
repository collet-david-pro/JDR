<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapPresenter;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Tokens\TokenPresenter;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;
use JDR\Realtime\EventReader;

/**
 * GET /sessions/{id}/snapshot (projet.md 10.1, contract P6): the whole state a client needs to
 * follow the session, with the last_event_id to subscribe from. The head of the event log is read
 * first, in the same transaction (one consistent snapshot) as the state.
 * - GM / co-GM: the map as the editor sees it, its placed tokens' definitions, the fog of the
 *   current floor, the revealed uids;
 * - player: PlayerFilter + game settings + fog_strict (PlayerView); no map in the lobby nor once
 *   ended (map null); 409 session_paused while paused (D5; the header is GET /sessions/{id}).
 * The thumbnail and the names of the palette are never given to a player.
 */
final class SnapshotService
{
    public function __construct(
        private SessionAccess $access,
        private SessionPresenter $sessionPresenter,
        private EventReader $reader,
        private PreloadService $preload,
        private FogStrictScope $scopes,
        private PlayerView $view,
        private MapPresenter $maps,
        private MapRepository $mapRepo,
        private MapSceneRepository $scene,
        private SessionRepository $sessions,
        private TokenRepository $tokens,
        private TokenPresenter $tokenPresenter,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function snapshot(User $user, int $sessionId, string $apiBase): array
    {
        return $this->sessions->db()->transaction(function () use ($user, $sessionId, $apiBase): array {
            $head = $this->reader->headId();
            $ctx = $this->access->resolve($user, $sessionId);
            if (!$ctx->isGm() && $ctx->session->state === Session::PAUSED) {
                PreloadService::requirePlayable($ctx->session);
            }
            $session = $this->sessionPresenter->one($ctx, $head);
            $map = $this->preload->currentMap($ctx->session);
            $empty = ['session' => $session, 'map' => null, 'tokens' => [], 'fog' => ['floor' => null, 'chunks' => []], 'revealed' => [], 'last_event_id' => $head];
            if ($map === null) {
                return $empty;
            }
            if ($ctx->isGm()) {
                return $this->gm($ctx, $map, $session, $head, $apiBase);
            }
            if ($ctx->session->state !== Session::RUNNING) {
                return $empty;
            }

            return $this->player($ctx, $user, $map, $session, $head, $apiBase);
        });
    }

    /**
     * @param array<string, mixed> $session
     * @return array<string, mixed>
     */
    private function gm(SessionContext $ctx, Map $map, array $session, int $head, string $apiBase): array
    {
        $full = $this->maps->full($map, $apiBase);
        $ids = array_map(static fn (array $t): int => (int) $t['token_id'], $full['tokens_placed']);

        return [
            'session' => $session,
            'map' => $full,
            'tokens' => $this->definitions($ctx->session->gameId, $ids, $apiBase),
            'fog' => $this->fog($ctx->session, $map),
            'revealed' => $this->scene->revealedUids($map->id),
            'last_event_id' => $head,
        ];
    }

    /**
     * @param array<string, mixed> $session
     * @return array<string, mixed>
     */
    private function player(SessionContext $ctx, User $user, Map $map, array $session, int $head, string $apiBase): array
    {
        $scope = $this->scopes->forUser($ctx, $user->id, $map->id);
        $assigned = [];
        foreach ($this->sessions->assignmentsOf([$ctx->session->id])[$ctx->session->id] ?? [] as $a) {
            $assigned[$a['token_id']] = $a['user_id'];
        }
        $full = $this->maps->full($map, $apiBase);
        $revealed = $this->scene->revealedUids($map->id);
        $bboxes = $scope->isRestricted() ? $this->scene->bboxes($map->id) : [];
        $objects = $this->view->objects($full['objects'], $revealed, $scope, $bboxes);
        $placed = $this->view->tokens($ctx, $user->id, $full['tokens_placed'], $scope, $assigned);
        $allowed = array_flip($this->preload->assetIds($ctx, $user, $map, $scope));

        $full['thumb_url'] = null;
        $full['objects'] = $objects;
        $full['tokens_placed'] = $placed;
        $full['palette'] = array_map(static function (?array $entry) use ($allowed): ?array {
            if ($entry === null) {
                return null;
            }
            $ok = isset($allowed[$entry['asset_id']]);

            return ['asset_id' => $entry['asset_id'], 'name' => '', 'url' => $ok ? $entry['url'] : null, 'thumb_url' => $ok ? $entry['thumb_url'] : null, 'autotile' => $entry['autotile']];
        }, $full['palette']);
        $present = array_flip(array_map(static fn (array $o): string => (string) $o['uid'], $objects));

        return [
            'session' => $session,
            'map' => $full,
            'tokens' => $this->definitions($ctx->session->gameId, array_map(static fn (array $t): int => (int) $t['token_id'], $placed), $apiBase),
            'fog' => $this->fog($ctx->session, $map),
            'revealed' => array_values(array_filter($revealed, static fn (string $uid): bool => isset($present[$uid]))),
            'last_event_id' => $head,
        ];
    }

    /**
     * @return array{floor: string|null, chunks: list<array{0: int, 1: int, 2: string}>}
     */
    private function fog(Session $session, Map $map): array
    {
        $floorId = $session->currentFloorId;
        if ($floorId === null) {
            $floorId = $this->mapRepo->floors($map->id)[0]['id'] ?? null;
        }
        if ($floorId === null) {
            return ['floor' => null, 'chunks' => []];
        }

        return [
            'floor' => (string) $floorId,
            'chunks' => array_map(
                static fn (array $c): array => [$c['cx'], $c['cy'], base64_encode($c['data'])],
                $this->scene->fog($map->id, $floorId),
            ),
        ];
    }

    /**
     * Definitions of the tokens of the game among $ids (signed images).
     *
     * @param list<int> $ids
     * @return list<array<string, mixed>>
     */
    private function definitions(int $gameId, array $ids, string $apiBase): array
    {
        $wanted = array_flip($ids);
        $tokens = array_values(array_filter(
            $this->tokens->listForGame($gameId),
            static fn ($t): bool => isset($wanted[$t->id]),
        ));

        return $this->tokenPresenter->many($tokens, $apiBase);
    }
}
