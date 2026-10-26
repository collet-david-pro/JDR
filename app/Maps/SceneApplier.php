<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;

/**
 * Applies the P5 ops of a lot (objects, placed tokens, fog; etapes/P05 "Contrat d'API P5") to a
 * locked map, for OpsApplier, in the lot order:
 * - object.add / maptoken.add: floor of the map, coordinates inside the map, token of the same
 *   game (not_found), <= 20 000 objects / 2 000 tokens per map (ops.<i>: too_many); a uid already
 *   used is a conflict "exists" (current = stored object);
 * - object.update / maptoken.update: unknown uid = conflict "gone" (current null); rev lower than
 *   the stored rev = conflict "stale" (current = stored object); else applied, rev + 1 (geometry
 *   and props validated against the stored type);
 * - object.remove / maptoken.remove: idempotent (an unknown uid is not an applied op);
 * - fog.reveal (bitwise OR, row created) / fog.hide (AND NOT): chunk inside the map, rows whose
 *   bitmap becomes all zero are deleted.
 * Validation errors throw (the caller's transaction rolls the whole lot back); conflicts are
 * collected per op. Objects and tokens are written at once; fog chunks by flush().
 */
final class SceneApplier
{
    /** @var array<string, array{id: int, object: array<string, mixed>}> exact uid => stored object */
    private array $objects = [];
    /** @var array<string, string> lower-case uid => exact uid (the uid column is case-insensitive) */
    private array $objectKeys = [];
    /** @var array<string, array{id: int, token: array<string, mixed>}> */
    private array $tokens = [];
    /** @var array<string, string> */
    private array $tokenKeys = [];
    private ?int $objectCount = null;
    private ?int $tokenCount = null;
    /** @var array<int, bool> token id => live token of the game */
    private array $gameTokens = [];
    /** @var array<string, array{floor: int, cx: int, cy: int, raw: string, existed: bool, dirty: bool}> */
    private array $fog = [];
    /** @var list<array<string, mixed>> */
    private array $conflicts = [];

    public function __construct(private MapState $state, private SceneStore $store)
    {
    }

    /**
     * Reads the stored objects / tokens named by the ops and locks the fog chunks they touch.
     *
     * @param list<array<string, mixed>> $ops
     */
    public function preload(array $ops): void
    {
        $objectUids = [];
        $tokenUids = [];
        $fogKeys = [];
        foreach ($ops as $op) {
            switch ($op['type']) {
                case 'object.add':
                    $objectUids[] = $op['object']['uid'];
                    break;
                case 'object.update':
                case 'object.remove':
                    $objectUids[] = $op['uid'];
                    break;
                case 'maptoken.add':
                    $tokenUids[] = $op['token']['uid'];
                    break;
                case 'maptoken.update':
                case 'maptoken.remove':
                    $tokenUids[] = $op['uid'];
                    break;
                case 'fog.reveal':
                case 'fog.hide':
                    if (in_array($op['floor'], $this->state->floorIds, true)) {
                        foreach ($op['chunks'] as [$cx, $cy]) {
                            $fogKeys[$op['floor']][$cx . ':' . $cy] = [$cx, $cy];
                        }
                    }
                    break;
            }
        }
        foreach ($this->store->objects($objectUids) as $row) {
            $this->remember($this->objects, $this->objectKeys, $row['object']['uid'], ['id' => $row['id'], 'object' => $row['object']]);
        }
        foreach ($this->store->tokens($tokenUids) as $row) {
            $this->remember($this->tokens, $this->tokenKeys, $row['token']['uid'], ['id' => $row['id'], 'token' => $row['token']]);
        }
        foreach ($fogKeys as $floorId => $keys) {
            $stored = $this->store->lockFog($floorId, array_values($keys));
            foreach ($keys as $key => [$cx, $cy]) {
                $raw = isset($stored[$key]) ? FogCodec::decode($stored[$key]) : null;
                $this->fog[$floorId . '|' . $key] = [
                    'floor' => $floorId,
                    'cx' => $cx,
                    'cy' => $cy,
                    'raw' => $raw ?? FogCodec::blank(),
                    'existed' => isset($stored[$key]),
                    // An unreadable stored chunk is rewritten (or deleted) by the next write.
                    'dirty' => isset($stored[$key]) && $raw === null,
                ];
            }
        }
    }

    /**
     * @param array<string, mixed> $op normalized by MapOpsInput
     * @return bool applied (false for a conflict or a no-op remove)
     * @throws ValidationException
     */
    public function apply(array $op, int $index): bool
    {
        $field = 'ops.' . $index;

        return match ($op['type']) {
            'object.add' => $this->objectAdd($op['object'], $field, $index),
            'object.update' => $this->objectUpdate($op, $field, $index),
            'object.remove' => $this->objectRemove($op['uid']),
            'maptoken.add' => $this->tokenAdd($op['token'], $field, $index),
            'maptoken.update' => $this->tokenUpdate($op, $field, $index),
            'maptoken.remove' => $this->tokenRemove($op['uid']),
            default => $this->fogOp($op, $field),
        };
    }

    /**
     * Writes the changed fog chunks.
     */
    public function flush(): void
    {
        foreach ($this->fog as $key => $chunk) {
            if (!$chunk['dirty']) {
                continue;
            }
            $this->store->writeFog($chunk['floor'], $chunk['cx'], $chunk['cy'], $chunk['raw'], $chunk['existed']);
            $this->fog[$key]['existed'] = !FogCodec::isEmpty($chunk['raw']);
            $this->fog[$key]['dirty'] = false;
        }
    }

    /**
     * Ops rejected individually: {op_index, kind, uid, reason, current}.
     *
     * @return list<array<string, mixed>>
     */
    public function conflicts(): array
    {
        return $this->conflicts;
    }

    /**
     * The map shrinks: objects and tokens that no longer fit are deleted, the bounding boxes of
     * the others are bounded again, fog chunks outside the map are deleted.
     */
    public function shrink(int $width, int $height): void
    {
        foreach ($this->store->allObjects() as $row) {
            $object = $row['object'];
            if (ObjectRules::fitsIn($object, $width, $height)) {
                $this->store->updateObject($row['id'], $object, ObjectRules::bbox($object, $width, $height));
                continue;
            }
            $this->store->deleteObject($row['id']);
            $this->forget($this->objects, $this->objectKeys, $object['uid']);
            if ($this->objectCount !== null) {
                $this->objectCount--;
            }
        }
        foreach ($this->store->allTokens() as $row) {
            $errors = [];
            if (TokenRules::checkBounds($row['token'], 'token', $errors, $width, $height)) {
                continue;
            }
            $this->store->deleteToken($row['id']);
            $this->forget($this->tokens, $this->tokenKeys, $row['token']['uid']);
            if ($this->tokenCount !== null) {
                $this->tokenCount--;
            }
        }
        $minCx = intdiv($width + 31, 32);
        $minCy = intdiv($height + 31, 32);
        $this->store->deleteFogBeyond($minCx, $minCy);
        foreach ($this->fog as $key => $chunk) {
            if ($chunk['cx'] >= $minCx || $chunk['cy'] >= $minCy) {
                unset($this->fog[$key]);
            }
        }
    }

    // ---- Objects ---------------------------------------------------------------------------

    /**
     * @param array<string, mixed> $object normalized (floor id as int)
     */
    private function objectAdd(array $object, string $field, int $index): bool
    {
        $this->requireFloor($object['floor'], $field . '.object.floor');
        $errors = [];
        $geometry = ObjectRules::geometry($object['type'], $object['geometry'], $field . '.object.geometry', $errors, $this->state->width, $this->state->height);
        if ($geometry === null) {
            throw new ValidationException('', $errors);
        }
        $existing = $this->find($this->objects, $this->objectKeys, $object['uid'], true);
        if ($existing !== null) {
            $this->conflict($index, 'object', $object['uid'], 'exists', $existing['object']);

            return false;
        }
        $this->objectCount ??= $this->store->objectCount();
        if ($this->objectCount >= ObjectRules::MAX_OBJECTS) {
            throw new ValidationException('', [$field => 'too_many']);
        }
        $api = ObjectRules::canonical(['floor' => (string) $object['floor'], 'geometry' => $geometry, 'rev' => 1] + $object);
        $id = $this->store->insertObject($api, ObjectRules::bbox($api, $this->state->width, $this->state->height));
        $this->remember($this->objects, $this->objectKeys, $api['uid'], ['id' => $id, 'object' => $api]);
        $this->objectCount++;

        return true;
    }

    /**
     * @param array<string, mixed> $op
     */
    private function objectUpdate(array $op, string $field, int $index): bool
    {
        $stored = $this->find($this->objects, $this->objectKeys, $op['uid'], false);
        if ($stored === null) {
            $this->conflict($index, 'object', $op['uid'], 'gone', null);

            return false;
        }
        $current = $stored['object'];
        if ($op['rev'] < $current['rev']) {
            $this->conflict($index, 'object', $op['uid'], 'stale', $current);

            return false;
        }
        $errors = [];
        $merged = ObjectRules::applyPatch($current, $op['patch'], $field . '.patch', $errors, $this->state->width, $this->state->height);
        if ($merged === null) {
            throw new ValidationException('', $errors);
        }
        $merged['rev'] = $current['rev'] + 1;
        $merged = ObjectRules::canonical($merged);
        $this->store->updateObject($stored['id'], $merged, ObjectRules::bbox($merged, $this->state->width, $this->state->height));
        $this->objects[$current['uid']] = ['id' => $stored['id'], 'object' => $merged];

        return true;
    }

    private function objectRemove(string $uid): bool
    {
        $stored = $this->find($this->objects, $this->objectKeys, $uid, false);
        if ($stored === null) {
            return false;
        }
        $this->store->deleteObject($stored['id']);
        $this->forget($this->objects, $this->objectKeys, $uid);
        if ($this->objectCount !== null) {
            $this->objectCount--;
        }

        return true;
    }

    // ---- Placed tokens ---------------------------------------------------------------------

    /**
     * @param array<string, mixed> $token normalized (floor and token_id as int)
     */
    private function tokenAdd(array $token, string $field, int $index): bool
    {
        $f = $field . '.token';
        $this->requireFloor($token['floor'], $f . '.floor');
        $errors = [];
        if (!TokenRules::checkBounds($token, $f, $errors, $this->state->width, $this->state->height)) {
            throw new ValidationException('', $errors);
        }
        $tokenId = (int) $token['token_id'];
        $this->gameTokens[$tokenId] ??= $this->store->isGameToken($tokenId);
        if (!$this->gameTokens[$tokenId]) {
            throw new ValidationException('', [$f . '.token_id' => 'not_found']);
        }
        $existing = $this->find($this->tokens, $this->tokenKeys, $token['uid'], true);
        if ($existing !== null) {
            $this->conflict($index, 'maptoken', $token['uid'], 'exists', $existing['token']);

            return false;
        }
        $this->tokenCount ??= $this->store->tokenCount();
        if ($this->tokenCount >= TokenRules::MAX_TOKENS) {
            throw new ValidationException('', [$field => 'too_many']);
        }
        $api = [];
        foreach (TokenRules::TOKEN_KEYS as $key) {
            $api[$key] = match ($key) {
                'floor' => (string) $token['floor'],
                'token_id' => $tokenId,
                'rev' => 1,
                default => $token[$key],
            };
        }
        $id = $this->store->insertToken($api);
        $this->remember($this->tokens, $this->tokenKeys, $api['uid'], ['id' => $id, 'token' => $api]);
        $this->tokenCount++;

        return true;
    }

    /**
     * @param array<string, mixed> $op
     */
    private function tokenUpdate(array $op, string $field, int $index): bool
    {
        $stored = $this->find($this->tokens, $this->tokenKeys, $op['uid'], false);
        if ($stored === null) {
            $this->conflict($index, 'maptoken', $op['uid'], 'gone', null);

            return false;
        }
        $current = $stored['token'];
        if ($op['rev'] < $current['rev']) {
            $this->conflict($index, 'maptoken', $op['uid'], 'stale', $current);

            return false;
        }
        $errors = [];
        if (!TokenRules::checkBounds($op['patch'], $field . '.patch', $errors, $this->state->width, $this->state->height)) {
            throw new ValidationException('', $errors);
        }
        $merged = array_replace($current, $op['patch'], ['rev' => $current['rev'] + 1]);
        $this->store->updateToken($stored['id'], $merged);
        $this->tokens[$current['uid']] = ['id' => $stored['id'], 'token' => $merged];

        return true;
    }

    private function tokenRemove(string $uid): bool
    {
        $stored = $this->find($this->tokens, $this->tokenKeys, $uid, false);
        if ($stored === null) {
            return false;
        }
        $this->store->deleteToken($stored['id']);
        $this->forget($this->tokens, $this->tokenKeys, $uid);
        if ($this->tokenCount !== null) {
            $this->tokenCount--;
        }

        return true;
    }

    // ---- Fog -------------------------------------------------------------------------------

    /**
     * @param array<string, mixed> $op
     */
    private function fogOp(array $op, string $field): bool
    {
        $floorId = $op['floor'];
        $this->requireFloor($floorId, $field . '.floor');
        foreach ($op['chunks'] as $j => [$cx, $cy]) {
            if ($cx * 32 >= $this->state->width || $cy * 32 >= $this->state->height) {
                throw new ValidationException('', [$field . '.chunks.' . $j => 'invalid']);
            }
        }
        $reveal = $op['type'] === 'fog.reveal';
        foreach ($op['chunks'] as [$cx, $cy, $bits]) {
            $key = $floorId . '|' . $cx . ':' . $cy;
            if (!isset($this->fog[$key])) {
                // Not preloaded (cannot happen for valid ops): read it now.
                $stored = $this->store->lockFog($floorId, [[$cx, $cy]]);
                $data = $stored[$cx . ':' . $cy] ?? null;
                $raw = $data === null ? null : FogCodec::decode($data);
                $this->fog[$key] = ['floor' => $floorId, 'cx' => $cx, 'cy' => $cy, 'raw' => $raw ?? FogCodec::blank(),
                    'existed' => $data !== null, 'dirty' => $data !== null && $raw === null];
            }
            $before = $this->fog[$key]['raw'];
            $after = $reveal ? FogCodec::union($before, $bits) : FogCodec::subtract($before, $bits);
            if ($after !== $before) {
                $this->fog[$key]['raw'] = $after;
                $this->fog[$key]['dirty'] = true;
            }
        }

        return true;
    }

    // ---- Helpers ---------------------------------------------------------------------------

    private function requireFloor(mixed $floorId, string $field): void
    {
        if (!in_array($floorId, $this->state->floorIds, true)) {
            throw new ValidationException('', [$field => 'not_found']);
        }
    }

    private function conflict(int $index, string $kind, string $uid, string $reason, ?array $current): void
    {
        $this->conflicts[] = ['op_index' => $index, 'kind' => $kind, 'uid' => $uid, 'reason' => $reason, 'current' => $current];
    }

    /**
     * Stored entry of $uid: exact match, or (for an add) any uid equal ignoring case.
     *
     * @param array<string, array<string, mixed>> $entries
     * @param array<string, string>               $keys
     * @return array<string, mixed>|null
     */
    private function find(array $entries, array $keys, string $uid, bool $ignoreCase): ?array
    {
        if (isset($entries[$uid])) {
            return $entries[$uid];
        }
        $exact = $ignoreCase ? ($keys[strtolower($uid)] ?? null) : null;

        return $exact === null ? null : ($entries[$exact] ?? null);
    }

    /**
     * @param array<string, array<string, mixed>> $entries
     * @param array<string, string>               $keys
     * @param array<string, mixed>                $entry
     */
    private function remember(array &$entries, array &$keys, string $uid, array $entry): void
    {
        $entries[$uid] = $entry;
        $keys[strtolower($uid)] = $uid;
    }

    /**
     * @param array<string, array<string, mixed>> $entries
     * @param array<string, string>               $keys
     */
    private function forget(array &$entries, array &$keys, string $uid): void
    {
        unset($entries[$uid]);
        if (($keys[strtolower($uid)] ?? null) === $uid) {
            unset($keys[strtolower($uid)]);
        }
    }
}
