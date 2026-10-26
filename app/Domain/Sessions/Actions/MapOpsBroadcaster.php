<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Sessions\EventFanout;
use JDR\Domain\Sessions\EventTypes;
use JDR\Domain\Sessions\FanoutBatch;
use JDR\Domain\Sessions\SessionAccess;
use JDR\Domain\Users\User;
use JDR\Maps\ChunkBuffer;
use JDR\Maps\FogCodec;
use JDR\Realtime\Audience;
use JDR\Realtime\Channel;

/**
 * D10 (etapes P06): the listener of POST /maps/{id}/ops. When the map is the current map of a
 * running or paused session, the lot writes, in the transaction of the ops (no change without
 * its event, projet.md 10.1; the map row is locked, so the state read before and after the ops
 * is the lot's own):
 * - map.ops (audience gm, channel map:{id}): {map_id, revision, ops (the applied ops as sent),
 *   actor};
 * - while running, the player versions on the session channel (FanoutBatch, D4):
 *   map.ops.public {map_id, revision, objects: {upsert, remove} filtered by PlayerFilter and the
 *   scope, chunks: [[floor, cx, cy]] tile blocks touched (the client reloads them through the
 *   filtered chunks endpoint), reload: palette / grid / layers / theme / name changed (the client
 *   reloads the snapshot)}, maptoken.added / .updated / .removed, fog.updated, ambient.changed,
 *   and what entered / left the fog_strict scopes. Paused: map.ops only (D5).
 * prepare() runs before the ops are applied (state before, scopes before), publish() after.
 */
final class MapOpsBroadcaster
{
    private const RELOAD_COLUMNS = ['name', 'cell_px', 'width_cells', 'height_cells', 'unit_label', 'unit_per_cell', 'theme', 'palette', 'layers'];

    public function __construct(
        private Db $db,
        private SessionAccess $access,
        private EventFanout $fanout,
        private MapSceneRepository $scene,
    ) {
    }

    /**
     * @param list<array<string, mixed>> $ops normalized (MapOpsInput::ops)
     * @return array<string, mixed>|null capture for publish(), null when no open session plays the map
     */
    public function prepare(Map $map, User $user, array $ops, string $clientOpId): ?array
    {
        $ids = array_map('intval', array_column($this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('play_sessions') . " WHERE `current_map_id` = ? AND `state` IN ('running', 'paused') ORDER BY `id`",
            [$map->id],
        ), 'id'));
        if ($ids === []) {
            return null;
        }
        $batches = [];
        foreach ($ids as $id) {
            $ctx = $this->access->resolve($user, $id);
            if ($ctx->isGm()) {
                $batches[] = $this->fanout->begin($ctx, $map, $user->id, $clientOpId);
            }
        }
        $objectUids = [];
        $tokenUids = [];
        $fog = [];
        foreach ($ops as $op) {
            match ($op['type']) {
                'object.add' => $objectUids[] = $op['object']['uid'],
                'object.update', 'object.remove' => $objectUids[] = $op['uid'],
                'maptoken.add' => $tokenUids[] = $op['token']['uid'],
                'maptoken.update', 'maptoken.remove' => $tokenUids[] = $op['uid'],
                default => null,
            };
            if ($op['type'] === 'fog.reveal' || $op['type'] === 'fog.hide') {
                foreach ($op['chunks'] as [$cx, $cy]) {
                    $fog[(int) $op['floor']][$cx . ':' . $cy] = [$cx, $cy];
                }
            }
        }

        return [
            'map' => $map,
            'actor' => $user->id,
            'op_id' => $clientOpId,
            'batches' => $batches,
            'object_uids' => $objectUids,
            'token_uids' => $tokenUids,
            'objects' => $this->objects($map->id, $objectUids),
            'tokens' => $this->tokens($map->id, $tokenUids),
            'fog_keys' => $fog,
            'fog' => $this->fog($map->id, $fog),
        ];
    }

    /**
     * @param array<string, mixed>       $capture prepare()
     * @param mixed                      $wireOps the ops of the request body
     * @param list<array<string, mixed>> $conflicts
     * @param list<ChunkBuffer>          $dirty
     * @param array<string, mixed>       $changed columns written (MapState::changedColumns)
     */
    public function publish(array $capture, int $revision, mixed $wireOps, array $conflicts, array $dirty, array $changed): void
    {
        /** @var Map $map */
        $map = $capture['map'];
        $skip = array_fill_keys(array_column($conflicts, 'op_index'), true);
        $applied = [];
        foreach (is_array($wireOps) ? array_values($wireOps) : [] as $i => $op) {
            if (!isset($skip[$i])) {
                $applied[] = $op;
            }
        }
        $this->fanout->record(Channel::map($map->id), EventTypes::MAP_OPS, Audience::GM, [
            'map_id' => $map->id,
            'revision' => $revision,
            'ops' => $applied,
            'actor' => (string) $capture['actor'],
        ], null, $capture['actor'], $capture['op_id']);

        $objectsAfter = $this->objects($map->id, $capture['object_uids']);
        $tokensAfter = $this->tokens($map->id, $capture['token_uids']);
        $fogAfter = $this->fog($map->id, $capture['fog_keys']);
        $blocks = [];
        foreach ($dirty as $chunk) {
            $blocks[$chunk->floorId . ':' . $chunk->cx . ':' . $chunk->cy] = [$chunk->floorId, $chunk->cx, $chunk->cy];
        }
        $reload = array_intersect_key($changed, array_flip(self::RELOAD_COLUMNS)) !== [];
        foreach ($capture['batches'] as $batch) {
            /** @var FanoutBatch $batch */
            $batch->setRevision($revision);
            if (!$batch->running()) {
                continue;
            }
            $batch->mapOps(self::pairs($capture['objects'], $objectsAfter), array_values($blocks), $reload);
            foreach (self::pairs($capture['tokens'], $tokensAfter) as [$before, $after]) {
                $batch->token($before, $after, EventTypes::TOKEN_UPDATED);
            }
            foreach ($capture['fog'] as $floorId => $chunks) {
                $added = [];
                $removed = [];
                foreach ($chunks as $key => $old) {
                    $new = $fogAfter[$floorId][$key] ?? FogCodec::blank();
                    [$cx, $cy] = array_map('intval', explode(':', $key));
                    $plus = FogCodec::subtract($new, $old);
                    $minus = FogCodec::subtract($old, $new);
                    if (!FogCodec::isEmpty($plus)) {
                        $added[] = [$cx, $cy, $plus];
                    }
                    if (!FogCodec::isEmpty($minus)) {
                        $removed[] = [$cx, $cy, $minus];
                    }
                }
                $batch->fog((int) $floorId, 'reveal', $added, false);
                $batch->fog((int) $floorId, 'hide', $removed, false);
            }
            if (array_key_exists('ambient', $changed)) {
                $batch->everyone(EventTypes::AMBIENT_CHANGED, ['ambient' => $changed['ambient']]);
            }
            $batch->refreshScopes();
        }
    }

    /**
     * [before, after] of every uid whose state changed.
     *
     * @param array<string, array<string, mixed>> $before
     * @param array<string, array<string, mixed>> $after
     * @return list<array{0: array<string, mixed>|null, 1: array<string, mixed>|null}>
     */
    private static function pairs(array $before, array $after): array
    {
        $out = [];
        foreach (array_keys($before + $after) as $uid) {
            $b = $before[$uid] ?? null;
            $a = $after[$uid] ?? null;
            if ($b !== $a) {
                $out[] = [$b, $a];
            }
        }

        return $out;
    }

    /**
     * @param list<string> $uids
     * @return array<string, array<string, mixed>> exact uid => object (API form)
     */
    private function objects(int $mapId, array $uids): array
    {
        $out = [];
        foreach ($uids === [] ? [] : $this->scene->objectsByUid($mapId, $uids) as $row) {
            $out[(string) $row['object']['uid']] = $row['object'];
        }

        return $out;
    }

    /**
     * @param list<string> $uids
     * @return array<string, array<string, mixed>>
     */
    private function tokens(int $mapId, array $uids): array
    {
        $out = [];
        foreach ($uids === [] ? [] : $this->scene->tokensByUid($mapId, $uids) as $row) {
            $out[(string) $row['token']['uid']] = $row['token'];
        }

        return $out;
    }

    /**
     * Raw fog bitmaps of the blocks (blank when absent): floor => "cx:cy" => raw.
     *
     * @param array<int, array<string, array{0: int, 1: int}>> $keys
     * @return array<int, array<string, string>>
     */
    private function fog(int $mapId, array $keys): array
    {
        $out = [];
        foreach ($keys as $floorId => $blocks) {
            $stored = $this->scene->fogForUpdate($mapId, $floorId, array_values($blocks));
            foreach (array_keys($blocks) as $key) {
                $raw = isset($stored[$key]) ? FogCodec::decode($stored[$key]) : null;
                $out[$floorId][$key] = $raw ?? FogCodec::blank();
            }
        }

        return $out;
    }
}
