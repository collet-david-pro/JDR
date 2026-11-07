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
    public function __construct(private MapSceneRepository $scene, private int $mapId, private int $gameId, private ?MapLinks $links = null)
    {
    }

    /**
     * Counts the objects of the map.
     */
    public function objectCount(): int
    {
        return $this->scene->countObjects($this->mapId);
    }

    /**
     * Returns the objects with the given uids.
     */
    public function objects(array $uids): array
    {
        return $uids === [] ? [] : $this->scene->objectsByUid($this->mapId, $uids);
    }

    /**
     * Returns every object of the map.
     */
    public function allObjects(): array
    {
        return $this->scene->objectRows($this->mapId);
    }

    /**
     * Inserts an object with its bounding box and returns its id.
     */
    public function insertObject(array $object, array $bbox): int
    {
        return $this->scene->insertObject($this->mapId, $object, $bbox);
    }

    /**
     * Updates an object row and its bounding box.
     */
    public function updateObject(int $id, array $object, array $bbox): void
    {
        $this->scene->updateObject($id, $object, $bbox);
    }

    /**
     * Deletes an object.
     */
    public function deleteObject(int $id): void
    {
        $this->scene->deleteObject($id);
    }

    /**
     * Counts the tokens of the map.
     */
    public function tokenCount(): int
    {
        return $this->scene->countTokens($this->mapId);
    }

    /**
     * Returns the tokens with the given uids.
     */
    public function tokens(array $uids): array
    {
        return $uids === [] ? [] : $this->scene->tokensByUid($this->mapId, $uids);
    }

    /**
     * Returns every token of the map.
     */
    public function allTokens(): array
    {
        return $this->scene->tokenRows($this->mapId);
    }

    /**
     * Inserts a token and returns its id.
     */
    public function insertToken(array $token): int
    {
        return $this->scene->insertToken($this->mapId, $token);
    }

    /**
     * Updates a token row.
     */
    public function updateToken(int $id, array $token): void
    {
        $this->scene->updateToken($id, $token);
    }

    /**
     * Deletes a token.
     */
    public function deleteToken(int $id): void
    {
        $this->scene->deleteToken($id);
    }

    /**
     * Tells whether the token belongs to the game of this map.
     */
    public function isGameToken(int $tokenId): bool
    {
        return $this->scene->isLiveGameToken($this->gameId, $tokenId);
    }

    /**
     * Selects and locks the fog chunks of the floor identified by their keys.
     */
    public function lockFog(int $floorId, array $keys): array
    {
        return $keys === [] ? [] : $this->scene->fogForUpdate($this->mapId, $floorId, $keys);
    }

    /**
     * Inserts, updates or deletes a fog chunk according to the raw data and whether it already existed.
     */
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

    /**
     * Deletes fog chunks beyond the given chunk coordinates.
     */
    public function deleteFogBeyond(int $minCx, int $minCy): void
    {
        $this->scene->deleteFogBeyond($this->mapId, $minCx, $minCy);
    }

    /**
     * Returns the floors of a linked target map, or null when link tracking is disabled.
     */
    public function linkFloors(int $mapId): ?array
    {
        return $this->links?->targetFloors($this->gameId, $mapId);
    }

    /**
     * Updates the link recorded for an object (null removes it), when link tracking is enabled.
     */
    public function syncLink(int $objectId, ?array $link): void
    {
        $this->links?->sync($this->mapId, $objectId, $link);
    }

    /**
     * Kind of a live asset (P14 image objects), null when there is none.
     */
    public function assetKind(int $assetId): ?string
    {
        return $this->scene->assetKind($assetId);
    }
}
