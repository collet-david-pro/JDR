<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Storage of the P5 content of ONE map used by SceneApplier (objects, placed tokens, fog),
 * inside the transaction that holds the map row lock (implemented by
 * JDR\Domain\Maps\MapSceneStore). Objects and tokens use their API form (see ObjectRules /
 * TokenRules, floor as a string id); rows are addressed by their primary key, so the
 * case-insensitive collation of the uid column never mixes two uids.
 */
interface SceneStore
{
    public function objectCount(): int;

    /**
     * Stored objects whose uid matches one of $uids (case-insensitively, like the unique key).
     *
     * @param list<string> $uids
     * @return list<array{id: int, object: array<string, mixed>}>
     */
    public function objects(array $uids): array;

    /**
     * Every object of the map (map resize).
     *
     * @return list<array{id: int, object: array<string, mixed>}>
     */
    public function allObjects(): array;

    /**
     * @param array<string, mixed>                             $object API form, rev included
     * @param array{0: float, 1: float, 2: float, 3: float}    $bbox
     * @return int row id
     */
    public function insertObject(array $object, array $bbox): int;

    /**
     * @param array<string, mixed>                          $object API form, rev included
     * @param array{0: float, 1: float, 2: float, 3: float} $bbox
     */
    public function updateObject(int $id, array $object, array $bbox): void;

    public function deleteObject(int $id): void;

    public function tokenCount(): int;

    /**
     * @param list<string> $uids
     * @return list<array{id: int, token: array<string, mixed>}>
     */
    public function tokens(array $uids): array;

    /**
     * @return list<array{id: int, token: array<string, mixed>}>
     */
    public function allTokens(): array;

    /**
     * @param array<string, mixed> $token API form, rev included
     */
    public function insertToken(array $token): int;

    /**
     * @param array<string, mixed> $token API form, rev included
     */
    public function updateToken(int $id, array $token): void;

    public function deleteToken(int $id): void;

    /**
     * Live token definition of the map's game.
     */
    public function isGameToken(int $tokenId): bool;

    /**
     * Locks and returns the stored fog chunks among $keys of a floor.
     *
     * @param list<array{0: int, 1: int}> $keys [cx, cy]
     * @return array<string, string> "cx:cy" => compressed data
     */
    public function lockFog(int $floorId, array $keys): array;

    /**
     * Writes a fog chunk: $raw null (or all zero) deletes the row.
     */
    public function writeFog(int $floorId, int $cx, int $cy, ?string $raw, bool $existed): void;

    /**
     * Deletes the fog chunks of every floor starting at or beyond these chunk coordinates.
     */
    public function deleteFogBeyond(int $minCx, int $minCy): void;
}
