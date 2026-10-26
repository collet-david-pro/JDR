<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ConflictException;
use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;

/**
 * GET /sessions/{id}/preload (projet.md 11.5, contract P6): signed URLs of the assets of the
 * current map, so that a player can download them (lobby, running) before the game. A player gets
 * the assets his fog_strict scope needs (PlayerView) and the images of the tokens he sees; the GM
 * all of them. D5: 409 session_paused while paused, 409 session_not_running once ended.
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
            return ['map_id' => null, 'floor_id' => null, 'assets' => [], 'total_bytes' => 0];
        }

        return [
            'map_id' => $map->id,
            'floor_id' => $ctx->session->currentFloorId,
            'assets' => $this->assets($ctx, $user, $map, $apiBase, $total),
            'total_bytes' => $total,
        ];
    }

    /**
     * Ids of the assets a user may fetch for the map: palette (scope), tokens he sees, pause screen.
     *
     * @return list<int>
     */
    public function assetIds(SessionContext $ctx, User $user, Map $map, FogScope $scope): array
    {
        $placed = $this->scene->tokens($map->id);
        if (!$ctx->isGm()) {
            $assigned = [];
            foreach ($this->sessions->assignmentsOf([$ctx->session->id])[$ctx->session->id] ?? [] as $a) {
                $assigned[$a['token_id']] = $a['user_id'];
            }
            $placed = $this->view->tokens($ctx, $user->id, $placed, $scope, $assigned);
        }
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
     * @return list<array<string, mixed>>
     */
    private function assets(SessionContext $ctx, User $user, Map $map, string $apiBase, ?int &$total): array
    {
        $scope = $ctx->isGm() ? FogScope::unrestricted() : $this->scopes->forUser($ctx, $user->id, $map->id);
        $rows = $this->queries->assets($this->assetIds($ctx, $user, $map, $scope));
        ksort($rows);
        $total = 0;
        $out = [];
        foreach ($rows as $id => $asset) {
            $out[] = ['id' => $id, 'url' => $this->urls->url($apiBase, $asset['uuid'], 'full'), 'bytes' => $asset['bytes'], 'kind' => $asset['kind']];
            $total += $asset['bytes'];
        }

        return $out;
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
