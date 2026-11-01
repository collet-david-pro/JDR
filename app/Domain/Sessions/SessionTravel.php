<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Maps\Collision;
use JDR\Maps\TokenRules;
use JDR\Realtime\Audience;
use JDR\Realtime\Channel;

/**
 * Tokens that travel with the session (P9a1, D2: only the GM travels): POST /sessions/{id}/change-map
 * {move_tokens: [placed token uids of the current map], focus: {x, y}}. In the transaction of the
 * change of map:
 * - the listed placed tokens of the map the session stands on are taken off it and put on the target
 *   map / floor around the focus point, on free cells (spiral; walls and other tokens avoided); same
 *   map = floor change (uid kept); another map = same token definition, same hidden / scale /
 *   rotation / light, uid kept unless the target map already uses it;
 * - one unknown uid refuses the whole request (422 move_tokens.<i> not_found, nothing moved);
 * - events: map.ops (GM, channel of each map, revision + 1) and maptoken.removed / maptoken.added
 *   (GM view and the player versions through FanoutBatch).
 */
final class SessionTravel
{
    private const MAX_RINGS = 15;
    private const RADIUS = 0.4;

    public function __construct(
        private MapRepository $maps,
        private MapSceneRepository $scene,
        private EventFanout $fanout,
    ) {
    }

    /**
     * @param list<string> $uids placed tokens of the map the session stands on
     * @return list<string> uids of the tokens moved
     * @throws ValidationException|NotFoundException
     */
    public function moveTokens(SessionContext $ctx, int $targetMapId, int $targetFloorId, array $uids, float $fx, float $fy, int $actor, ?string $opId): array
    {
        $originId = $ctx->session->currentMapId ?? throw new ValidationException('', ['move_tokens' => 'invalid']);
        $ids = array_values(array_unique([$originId, $targetMapId]));
        sort($ids);
        $locked = [];
        foreach ($ids as $id) {
            $locked[$id] = $this->maps->findForUpdate($id) ?? throw new NotFoundException();
        }
        $origin = $locked[$originId];
        $target = $locked[$targetMapId];
        $found = [];
        foreach ($this->scene->tokensByUid($originId, $uids) as $row) {
            $found[strtolower((string) $row['token']['uid'])] = $row;
        }
        $rows = [];
        $errors = [];
        foreach ($uids as $i => $uid) {
            $row = $found[strtolower($uid)] ?? null;
            if ($row === null) {
                $errors['move_tokens.' . $i] = 'not_found';
            } else {
                $rows[] = $row;
            }
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $same = $originId === $targetMapId;
        if (!$same && $this->scene->countTokens($targetMapId) + count($rows) > TokenRules::MAX_TOKENS) {
            throw new ValidationException('', ['move_tokens' => 'too_many']);
        }

        $moved = [];
        foreach ($rows as $row) {
            $this->scene->deleteToken($row['id']);
        }
        $spots = $this->spots($target, $targetFloorId, $fx, $fy, count($rows), $uids);
        $added = [];
        foreach ($rows as $i => $row) {
            $token = $row['token'];
            $after = ['floor' => (string) $targetFloorId, 'x' => $spots[$i][0], 'y' => $spots[$i][1],
                'rev' => $same ? $token['rev'] + 1 : 1] + $token;
            if (!$same && $this->scene->tokensByUid($targetMapId, [$after['uid']]) !== []) {
                $after['uid'] = bin2hex(random_bytes(8));
            }
            $this->scene->insertToken($targetMapId, $after);
            $added[] = [$token, $after];
            $moved[] = $after['uid'];
        }

        $this->emit($ctx, $origin, $target, $added, $actor, $opId);

        return $moved;
    }

    /**
     * Free positions around the focus: the focus itself, then cell centres by distance.
     *
     * @param list<string> $ignoreUids tokens being moved (their old place is free)
     * @return list<array{0: int|float, 1: int|float}>
     */
    private function spots(Map $map, int $floorId, float $fx, float $fy, int $count, array $ignoreUids): array
    {
        $segments = Collision::segments(array_values(array_filter(
            $this->scene->objects($map->id, $floorId),
            static fn (array $o): bool => in_array($o['type'], ['wall', 'door', 'window'], true),
        )), []);
        $taken = [];
        $ignore = array_fill_keys(array_map('strtolower', $ignoreUids), true);
        foreach ($this->scene->tokens($map->id) as $t) {
            if ((int) $t['floor'] === $floorId && !isset($ignore[strtolower((string) $t['uid'])])) {
                $taken[] = [(float) $t['x'], (float) $t['y']];
            }
        }
        $fx = max(0.0, min((float) $map->width, $fx));
        $fy = max(0.0, min((float) $map->height, $fy));
        $candidates = [[$fx, $fy]];
        $cx = (int) floor($fx);
        $cy = (int) floor($fy);
        for ($k = 0; $k <= self::MAX_RINGS; $k++) {
            $ring = [];
            for ($dy = -$k; $dy <= $k; $dy++) {
                for ($dx = -$k; $dx <= $k; $dx++) {
                    $x = $cx + $dx;
                    $y = $cy + $dy;
                    if (max(abs($dx), abs($dy)) === $k && $x >= 0 && $y >= 0 && $x < $map->width && $y < $map->height) {
                        $ring[] = [$x + 0.5, $y + 0.5];
                    }
                }
            }
            usort($ring, static fn (array $a, array $b): int => hypot($a[0] - $fx, $a[1] - $fy) <=> hypot($b[0] - $fx, $b[1] - $fy));
            array_push($candidates, ...$ring);
        }
        $out = [];
        foreach ($candidates as [$x, $y]) {
            if (count($out) === $count) {
                break;
            }
            if (self::free($segments, $taken, $x, $y)) {
                $out[] = [MapSceneRepository::num($x), MapSceneRepository::num($y)];
                $taken[] = [$x, $y];
            }
        }
        while (count($out) < $count) {
            $out[] = [MapSceneRepository::num($fx), MapSceneRepository::num($fy)];
        }

        return $out;
    }

    /**
     * @param list<array{0: float, 1: float, 2: float, 3: float}> $segments
     * @param list<array{0: float, 1: float}>                      $taken
     */
    private static function free(array $segments, array $taken, float $x, float $y): bool
    {
        foreach ($segments as [$ax, $ay, $bx, $by]) {
            if (Collision::distance($x, $y, $ax, $ay, $bx, $by) < self::RADIUS) {
                return false;
            }
        }
        foreach ($taken as [$tx, $ty]) {
            if (hypot($x - $tx, $y - $ty) < 0.9) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param list<array{0: array<string, mixed>, 1: array<string, mixed>}> $moves [before, after]
     */
    private function emit(SessionContext $ctx, Map $origin, Map $target, array $moves, int $actor, ?string $opId): void
    {
        if ($moves === []) {
            return;
        }
        $same = $origin->id === $target->id;
        $removeOps = array_map(static fn (array $m): array => ['type' => 'maptoken.remove', 'uid' => (string) $m[0]['uid']], $moves);
        $addOps = array_map(static fn (array $m): array => ['type' => 'maptoken.add', 'token' => $m[1]], $moves);
        foreach ($same ? [$origin->id => [...$removeOps, ...$addOps]] : [$origin->id => $removeOps, $target->id => $addOps] as $mapId => $ops) {
            $this->maps->update($mapId, [], true);
            $this->fanout->record(Channel::map($mapId), EventTypes::MAP_OPS, Audience::GM, [
                'map_id' => $mapId,
                'revision' => $this->maps->find($mapId)?->revision ?? 0,
                'ops' => $ops,
                'actor' => (string) $actor,
            ], null, $actor, $opId);
        }
        $batch = $this->fanout->begin($ctx, $origin, $actor, $opId);
        foreach ($moves as [$before, $after]) {
            $batch->gm(EventTypes::TOKEN_REMOVED, ['uid' => (string) $before['uid']]);
            $batch->token($before, null, EventTypes::TOKEN_REMOVED);
        }
        if (!$same) {
            $batch = $this->fanout->begin($ctx, $target, $actor, $opId);
        }
        foreach ($moves as [$before, $after]) {
            $batch->gm(EventTypes::TOKEN_ADDED, $after);
            $batch->token(null, $after, EventTypes::TOKEN_ADDED);
        }
    }
}
