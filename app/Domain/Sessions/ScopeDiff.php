<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapSceneRepository;

/**
 * Part of FanoutBatch: what enters or leaves a fog_strict scope when it changes (a player, or the
 * table of P7b), and the map.ops.public payload (D10).
 */
final class ScopeDiff
{
    public function __construct(private MapSceneRepository $scene, private Map $map)
    {
    }

    /**
     * What entered or left the scope of $user: map.ops.public {objects, chunks: new blocks},
     * maptoken.added / maptoken.removed.
     *
     * @param list<array<string, mixed>>|null $tokens placed tokens of the map (read once)
     * @return list<array{0: string, 1: array<string, mixed>}>
     */
    public function changes(PlayerSight $sight, int $user, FogScope $old, FogScope $new, int $revision, ?array &$tokens): array
    {
        [$added, $removed] = self::blockDiff($old, $new);
        if ($added === [] && $removed === []) {
            return [];
        }
        $tokens ??= $this->scene->tokens($this->map->id);
        $upsert = [];
        $remove = [];
        foreach ($this->objectsNear(array_merge($added, $removed)) as $object) {
            $v0 = $sight->object($object, $old);
            $v1 = $sight->object($object, $new);
            if ($v1 !== null && $v0 === null) {
                $upsert[] = $v1;
            } elseif ($v1 === null && $v0 !== null) {
                $remove[] = (string) $v0['uid'];
            }
        }
        $out = [];
        if ($upsert !== [] || $remove !== [] || $added !== []) {
            $out[] = [EventTypes::MAP_OPS_PUBLIC, self::opsPayload($this->map->id, $revision, $upsert, $remove, $added, false)];
        }
        foreach ($tokens as $token) {
            $t0 = $sight->token($token, $user, $old);
            $t1 = $sight->token($token, $user, $new);
            if ($t1 !== null && $t0 === null) {
                $out[] = [EventTypes::TOKEN_ADDED, $t1];
            } elseif ($t1 === null && $t0 !== null) {
                $out[] = [EventTypes::TOKEN_REMOVED, ['uid' => (string) $t0['uid']]];
            }
        }

        return $out;
    }

    /**
     * map.ops.public payload: {map_id, revision, objects: {upsert, remove}, chunks: [[floor, cx, cy]], reload}.
     *
     * @param list<array<string, mixed>>          $upsert
     * @param list<string>                        $remove
     * @param list<array{0: int, 1: int, 2: int}> $chunks
     * @return array<string, mixed>
     */
    public static function opsPayload(int $mapId, int $revision, array $upsert, array $remove, array $chunks, bool $reload): array
    {
        return [
            'map_id' => $mapId,
            'revision' => $revision,
            'objects' => ['upsert' => $upsert, 'remove' => $remove],
            'chunks' => array_map(static fn (array $b): array => [(string) $b[0], $b[1], $b[2]], $chunks),
            'reload' => $reload,
        ];
    }

    /**
     * Objects whose box touches one of the blocks [floor, cx, cy].
     *
     * @param list<array{0: int, 1: int, 2: int}> $blocks
     * @return list<array<string, mixed>>
     */
    private function objectsNear(array $blocks): array
    {
        $boxes = [];
        foreach ($blocks as [$floor, $cx, $cy]) {
            $b = $boxes[$floor] ?? [INF, INF, -INF, -INF];
            $boxes[$floor] = [min($b[0], $cx * 32), min($b[1], $cy * 32), max($b[2], $cx * 32 + 32), max($b[3], $cy * 32 + 32)];
        }
        $out = [];
        foreach ($boxes as $floor => $box) {
            foreach ($this->scene->objects($this->map->id, $floor, $box) as $object) {
                $out[] = $object;
            }
        }

        return $out;
    }

    /**
     * Blocks [floor, cx, cy] allowed by $new only, and by $old only.
     *
     * @return array{0: list<array{0: int, 1: int, 2: int}>, 1: list<array{0: int, 1: int, 2: int}>}
     */
    private static function blockDiff(FogScope $old, FogScope $new): array
    {
        $set = static function (FogScope $s): array {
            $out = [];
            foreach ($s->floors() as $floor) {
                foreach ($s->cells($floor) ?? [] as [$cx, $cy]) {
                    $out[$floor . ':' . $cx . ':' . $cy] = [$floor, $cx, $cy];
                }
            }

            return $out;
        };
        $a = $set($old);
        $b = $set($new);

        return [array_values(array_diff_key($b, $a)), array_values(array_diff_key($a, $b))];
    }
}
