<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Maps\FogCodec;
use JDR\Maps\SceneStore;

/**
 * SceneStore of one map (game $gameId) on MapSceneRepository, for SceneApplier.
 */
final class MapSceneStore implements SceneStore
{
    public function __construct(private MapSceneRepository $scene, private int $mapId, private int $gameId)
    {
    }

    public function objectCount(): int
    {
        return $this->scene->countObjects($this->mapId);
    }

    public function objects(array $uids): array
    {
        return $uids === [] ? [] : $this->scene->objectsByUid($this->mapId, $uids);
    }

    public function allObjects(): array
    {
        return $this->scene->objectRows($this->mapId);
    }

    public function insertObject(array $object, array $bbox): int
    {
        return $this->scene->insertObject($this->mapId, $object, $bbox);
    }

    public function updateObject(int $id, array $object, array $bbox): void
    {
        $this->scene->updateObject($id, $object, $bbox);
    }

    public function deleteObject(int $id): void
    {
        $this->scene->deleteObject($id);
    }

    public function tokenCount(): int
    {
        return $this->scene->countTokens($this->mapId);
    }

    public function tokens(array $uids): array
    {
        return $uids === [] ? [] : $this->scene->tokensByUid($this->mapId, $uids);
    }

    public function allTokens(): array
    {
        return $this->scene->tokenRows($this->mapId);
    }

    public function insertToken(array $token): int
    {
        return $this->scene->insertToken($this->mapId, $token);
    }

    public function updateToken(int $id, array $token): void
    {
        $this->scene->updateToken($id, $token);
    }

    public function deleteToken(int $id): void
    {
        $this->scene->deleteToken($id);
    }

    public function isGameToken(int $tokenId): bool
    {
        return $this->scene->isLiveGameToken($this->gameId, $tokenId);
    }

    public function lockFog(int $floorId, array $keys): array
    {
        return $keys === [] ? [] : $this->scene->fogForUpdate($this->mapId, $floorId, $keys);
    }

    public function writeFog(int $floorId, int $cx, int $cy, ?string $raw, bool $existed): void
    {
        if ($raw === null || FogCodec::isEmpty($raw)) {
            if ($existed) {
                $this->scene->deleteFog($this->mapId, $floorId, $cx, $cy);
            }

            return;
        }
        $data = FogCodec::encode($raw);
        $existed
            ? $this->scene->updateFog($this->mapId, $floorId, $cx, $cy, $data)
            : $this->scene->insertFog($this->mapId, $floorId, $cx, $cy, $data);
    }

    public function deleteFogBeyond(int $minCx, int $minCy): void
    {
        $this->scene->deleteFogBeyond($this->mapId, $minCx, $minCy);
    }
}
