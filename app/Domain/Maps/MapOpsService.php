<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Assets\AssetPolicy;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Maps\Versions\MapVersionService;
use JDR\Domain\Users\User;
use JDR\Maps\ChunkCodec;
use JDR\Maps\MapState;
use JDR\Maps\ObjectRules;
use JDR\Maps\OpsApplier;
use JDR\Maps\TokenRules;

/**
 * POST /maps/{id}/ops (projet.md 11.4 points 1-4 and 6, contract P4b; events = P6):
 * 1. rights (GM / co-GM), limits (MapOpsInput), client_op_id already processed => same response;
 * 2. transaction, SELECT ... FOR UPDATE on the map row (serializes the writers of a map);
 * 3. ops applied by OpsApplier (chunks read FOR UPDATE, last writer wins per cell);
 * 4. chunks written (empty => row deleted), map_asset_refs updated by exact deltas,
 *    changed columns + revision + 1 + updated_at, response remembered in processed_ops;
 * 6. response {revision, applied, conflicts: []}.
 * P4c: an auto version snapshot may be taken in the same transaction (MapVersionService::afterOps).
 * P5: object / placed-token / fog ops (SceneApplier through MapSceneStore); conflicting ops are
 * listed in conflicts [{op_index, kind, uid, reason, current}] and not applied; the revision
 * moves (+ 1) only when at least one op was applied. The response is remembered with its
 * conflicts.
 * A replayed client_op_id of another user or another map is refused (422 already_used).
 */
final class MapOpsService
{
    public function __construct(
        private MapRepository $maps,
        private MapPolicy $policy,
        private AssetRepository $assets,
        private AssetPolicy $assetPolicy,
        private MapVersionService $versions,
        private MapSceneRepository $scene,
    ) {
    }

    /**
     * @param array<array-key, mixed> $body {base_revision, client_op_id, ops}
     * @return array{revision: int, applied: int, conflicts: list<mixed>}
     */
    public function apply(User $user, int $mapId, array $body): array
    {
        [$map, $game] = $this->policy->requireEdit($user, $mapId);
        $envelope = MapOpsInput::envelope($body);
        $clientOpId = $envelope['client_op_id'];
        $replay = $this->replay($user, $map->id, $clientOpId);
        if ($replay !== null) {
            return $replay;
        }
        $ops = MapOpsInput::ops($envelope['ops']);

        $allowed = [];
        $canUse = function (int $assetId) use ($user, $game, &$allowed): bool {
            if (!isset($allowed[$assetId])) {
                $asset = $this->assets->find($assetId);
                $allowed[$assetId] = $asset !== null && $this->assetPolicy->canUseInGame($user, $asset, $game->id);
            }

            return $allowed[$assetId];
        };

        return $this->maps->db()->transaction(function () use ($user, $map, $game, $ops, $envelope, $clientOpId, $canUse): array {
            $locked = $this->maps->findForUpdate($map->id);
            if ($locked === null || $locked->deletedAt !== null) {
                throw new NotFoundException();
            }
            // A concurrent request with the same client_op_id may have committed meanwhile.
            $replay = $this->replay($user, $locked->id, $clientOpId);
            if ($replay !== null) {
                return $replay;
            }
            if ($ops === []) {
                return ['revision' => $locked->revision, 'applied' => 0, 'conflicts' => []];
            }
            $state = new MapState(
                $locked->revision,
                $locked->name,
                $locked->width,
                $locked->height,
                $locked->cellPx,
                $locked->unitLabel,
                $locked->unitPerCell,
                $locked->theme,
                $locked->ambient,
                $locked->palette,
                $locked->layers,
                array_map(static fn (array $f): int => $f['id'], $this->maps->floors($locked->id)),
            );
            $applier = new OpsApplier(
                $state,
                new MapChunkStore($this->maps, $locked->id),
                $canUse,
                new MapSceneStore($this->scene, $locked->id, $game->id),
            );
            $applied = $applier->apply($ops, $envelope['base_revision']);
            $conflicts = $applier->conflicts();
            if ($applied === 0) {
                // Only conflicts / no-op removes: nothing changed, the revision stays.
                $response = ['revision' => $locked->revision, 'applied' => 0, 'conflicts' => $conflicts];
                $this->remember($clientOpId, $user, $locked->id, $response);

                return $response;
            }

            $revision = $locked->revision + 1;
            foreach ($applier->dirtyChunks() as $chunk) {
                if (ChunkCodec::isEmpty($chunk->raw)) {
                    if ($chunk->existed) {
                        $this->maps->deleteChunk($locked->id, $chunk->floorId, $chunk->layer, $chunk->cx, $chunk->cy);
                    }
                    continue;
                }
                $data = ChunkCodec::compress($chunk->raw);
                $chunk->existed
                    ? $this->maps->updateChunk($locked->id, $chunk->floorId, $chunk->layer, $chunk->cx, $chunk->cy, $data, $revision)
                    : $this->maps->insertChunk($locked->id, $chunk->floorId, $chunk->layer, $chunk->cx, $chunk->cy, $data, $revision);
            }
            $this->maps->applyRefDeltas($locked->id, $applier->refDeltas());
            $this->maps->update($locked->id, $state->changedColumns(), true);
            $this->versions->afterOps($locked, $revision, $user->id);

            $response = ['revision' => $revision, 'applied' => $applied, 'conflicts' => $conflicts];
            $this->remember($clientOpId, $user, $locked->id, $response);

            return $response;
        });
    }

    /**
     * @param array<string, mixed> $response
     */
    private function remember(string $clientOpId, User $user, int $mapId, array $response): void
    {
        try {
            $this->maps->rememberProcessed($clientOpId, $user->id, ['map_id' => $mapId] + $response);
        } catch (\PDOException $e) {
            if ((string) $e->getCode() !== '23000') {
                throw $e;
            }
            throw new ValidationException('', ['client_op_id' => 'already_used']);
        }
    }

    /**
     * Remembered response of an already processed lot, or null when $clientOpId is new.
     *
     * @return array{revision: int, applied: int, conflicts: list<mixed>}|null
     * @throws ValidationException client_op_id already used by another user / map / request kind
     */
    private function replay(User $user, int $mapId, string $clientOpId): ?array
    {
        $row = $this->maps->processed($clientOpId);
        if ($row === null) {
            return null;
        }
        $r = $row['response'];
        if ($row['user_id'] !== $user->id || !is_array($r) || ($r['map_id'] ?? null) !== $mapId
            || !is_int($r['revision'] ?? null) || !is_int($r['applied'] ?? null)) {
            throw new ValidationException('', ['client_op_id' => 'already_used']);
        }

        return [
            'revision' => $r['revision'],
            'applied' => $r['applied'],
            'conflicts' => is_array($r['conflicts'] ?? null) ? array_map(self::storedConflict(...), array_values($r['conflicts'])) : [],
        ];
    }

    /**
     * Conflict read back from processed_ops (MySQL JSON reorders keys): canonical key order.
     *
     * @return array<string, mixed>
     */
    private static function storedConflict(mixed $c): array
    {
        $c = is_array($c) ? $c : [];
        $current = $c['current'] ?? null;
        if (is_array($current)) {
            if (($c['kind'] ?? null) === 'object') {
                $current = ObjectRules::canonical($current);
            } else {
                $ordered = [];
                foreach (TokenRules::TOKEN_KEYS as $key) {
                    if (array_key_exists($key, $current)) {
                        $ordered[$key] = $key === 'light_override' ? TokenRules::canonicalLight($current[$key]) : $current[$key];
                    }
                }
                $current = $ordered;
            }
        }

        return [
            'op_index' => $c['op_index'] ?? null,
            'kind' => $c['kind'] ?? null,
            'uid' => $c['uid'] ?? null,
            'reason' => $c['reason'] ?? null,
            'current' => $current,
        ];
    }
}
