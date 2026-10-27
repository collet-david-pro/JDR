<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ConflictException;
use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Displays\Display;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;

/**
 * GET /sessions/{id}/preload (projet.md 11.5, contract P6): signed URLs of the assets of the
 * current map, so that a player can download them (lobby, running) before the game. A player gets
 * the assets his fog_strict scope needs (PlayerView) and the images of the tokens he sees; the GM
 * all of them. D5: 409 session_paused while paused, 409 session_not_running once ended. A
 * projection screen (P7b) gets the assets of the table view, same states as a player.
 */
final class PreloadService
{
    public function __construct(
        private SessionAccess $access,
        private MapRepository $maps,
        private MapSceneRepository $scene,
        private SessionSceneQueries $queries,
        private FogStrictScope $scopes,
        private PlayerView $view,
        private TokenRepository $tokens,
        private SessionRepository $sessions,
        private AssetUrls $urls,
        private TableView $table,
    ) {
    }

    /**
     * @return array{map_id: int|null, floor_id: int|null, assets: list<array<string, mixed>>, total_bytes: int}
     */
    public function preload(User $user, int $sessionId, string $apiBase): array
    {
        $ctx = $this->access->resolve($user, $sessionId);
        if (!$ctx->isGm()) {
            $this->requirePlayable($ctx->session);
        }
        $map = $this->currentMap($ctx->session);
        if ($map === null) {
            return self::none();
        }
        if ($ctx->isGm()) {
            return $this->result($ctx, $map, $this->scene->tokens($map->id), FogScope::unrestricted(), $apiBase);
        }
        $scope = $this->scopes->forUser($ctx, $user->id, $map->id);

        return $this->result($ctx, $map, $this->sight($ctx, $user->id, $this->assignments($ctx), $scope), $scope, $apiBase);
    }

    /**
     * GET /sessions/{id}/preload?as=display (P7b): the assets of the table view (TableView).
     *
     * @return array{map_id: int|null, floor_id: int|null, assets: list<array<string, mixed>>, total_bytes: int}
     */
    public function preloadForDisplay(Display $display, int $sessionId, string $apiBase): array
    {
        $ctx = $this->access->resolveDisplay($display, $sessionId);
        $this->requirePlayable($ctx->session);
        $map = $this->currentMap($ctx->session);
        if ($map === null) {
            return self::none();
        }
        $scope = $this->table->scope($ctx, $map->id);

        return $this->result($ctx, $map, $this->sight($ctx, TableView::USER, $this->table->assignments($ctx), $scope), $scope, $apiBase);
    }

    /**
     * Ids of the assets a reader may fetch for the map: palette (scope), tokens he sees ($placed:
     * the placed tokens of the map he sees), pause screen.
     *
     * @param list<array<string, mixed>> $placed
     * @return list<int>
     */
    public function assetIds(SessionContext $ctx, Map $map, array $placed, FogScope $scope): array
    {
        $seen = array_fill_keys(array_map(static fn (array $t): int => (int) $t['token_id'], $placed), true);
        $ids = $this->view->paletteAssetIds($map, $scope);
        foreach ($this->tokens->listForGame($ctx->session->gameId) as $token) {
            if ($token->assetId !== null && isset($seen[$token->id])) {
                $ids[] = $token->assetId;
            }
        }
        $pause = $ctx->session->pauseScreen['asset_id'] ?? null;
        if ($pause !== null) {
            $ids[] = (int) $pause;
        }

        return array_values(array_unique($ids));
    }

    /**
     * Placed tokens of the map seen by $viewer (a player, or TableView::USER) under $scope.
     *
     * @param array<int, int> $assigned token definition id => owner
     * @return list<array<string, mixed>>
     */
    public function sight(SessionContext $ctx, int $viewer, array $assigned, FogScope $scope): array
    {
        $mapId = $ctx->session->currentMapId;

        return $mapId === null ? [] : $this->view->tokens($ctx, $viewer, $this->scene->tokens($mapId), $scope, $assigned);
    }

    /**
     * Assignments of the session: token definition id => user id.
     *
     * @return array<int, int>
     */
    public function assignments(SessionContext $ctx): array
    {
        $assigned = [];
        foreach ($this->sessions->assignmentsOf([$ctx->session->id])[$ctx->session->id] ?? [] as $a) {
            $assigned[$a['token_id']] = $a['user_id'];
        }

        return $assigned;
    }

    /**
     * @param list<array<string, mixed>> $placed
     * @return array{map_id: int|null, floor_id: int|null, assets: list<array<string, mixed>>, total_bytes: int}
     */
    private function result(SessionContext $ctx, Map $map, array $placed, FogScope $scope, string $apiBase): array
    {
        $rows = $this->queries->assets($this->assetIds($ctx, $map, $placed, $scope));
        ksort($rows);
        $total = 0;
        $out = [];
        foreach ($rows as $id => $asset) {
            $out[] = ['id' => $id, 'url' => $this->urls->url($apiBase, $asset['uuid'], 'full'), 'bytes' => $asset['bytes'], 'kind' => $asset['kind']];
            $total += $asset['bytes'];
        }

        return ['map_id' => $map->id, 'floor_id' => $ctx->session->currentFloorId, 'assets' => $out, 'total_bytes' => $total];
    }

    /**
     * @return array{map_id: null, floor_id: null, assets: list<array<string, mixed>>, total_bytes: int}
     */
    private static function none(): array
    {
        return ['map_id' => null, 'floor_id' => null, 'assets' => [], 'total_bytes' => 0];
    }

    public function currentMap(Session $session): ?Map
    {
        if ($session->currentMapId === null) {
            return null;
        }
        $map = $this->maps->find($session->currentMapId);

        return $map === null || $map->deletedAt !== null ? null : $map;
    }

    /**
     * @throws ConflictException session_paused | session_not_running
     */
    public static function requirePlayable(Session $session): void
    {
        if ($session->state === Session::PAUSED) {
            throw new ConflictException('', ['state' => $session->state], 'session_paused');
        }
        if ($session->state === Session::ENDED) {
            throw new ConflictException('', ['state' => $session->state], 'session_not_running');
        }
    }
}
