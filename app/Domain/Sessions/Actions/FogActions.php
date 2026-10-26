<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Sessions\FanoutBatch;
use JDR\Domain\Sessions\SessionSceneQueries;
use JDR\Maps\FogCodec;

/**
 * fog.reveal / fog.hide actions (projet.md 12.3, 14.2; etapes P06 D9):
 * - fog.reveal: bitwise OR (row created). For a player, the bits are first ANDed with the mask of
 *   the disks (current position, vision.range + 1) of his assigned, visible tokens on that floor
 *   (FogMask): no bit out of range is ever stored; result {rejected_bits};
 * - fog.hide (GM): AND NOT; a bitmap that becomes all zero deletes its row.
 * fog.updated carries the bits really added / removed; when a block row appears or disappears,
 * the fog_strict scopes of the players are read again (explored blocks belong to every scope).
 */
final class FogActions
{
    public function __construct(private MapSceneRepository $scene, private SessionSceneQueries $queries)
    {
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    public function apply(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $floorId = (int) $a['floor'];
        $reveal = $a['type'] === 'fog.reveal';
        $mapId = $s->map->id;
        $keys = [];
        foreach ($a['chunks'] as [$cx, $cy]) {
            $keys[$cx . ':' . $cy] = [$cx, $cy];
        }
        $stored = $this->scene->fogForUpdate($mapId, $floorId, array_values($keys));
        $disks = $reveal && !$s->isGm() ? $this->disks($s, $floorId) : null;
        $state = [];
        $rejected = 0;
        foreach ($a['chunks'] as [$cx, $cy, $bits]) {
            $key = $cx . ':' . $cy;
            if (!isset($state[$key])) {
                $old = isset($stored[$key]) ? FogCodec::decode($stored[$key]) : null;
                $state[$key] = ['cx' => $cx, 'cy' => $cy, 'existed' => isset($stored[$key]), 'old' => $old ?? FogCodec::blank(), 'raw' => $old ?? FogCodec::blank()];
            }
            if ($disks !== null) {
                $mask = FogMask::block($cx, $cy, $disks);
                $rejected += FogMask::bits($bits & ~$mask);
                $bits &= $mask;
            }
            $state[$key]['raw'] = $reveal ? FogCodec::union($state[$key]['raw'], $bits) : FogCodec::subtract($state[$key]['raw'], $bits);
        }
        $diffs = [];
        $rows = false;
        foreach ($state as $c) {
            if ($c['raw'] === $c['old']) {
                continue;
            }
            $empty = FogCodec::isEmpty($c['raw']);
            if ($empty) {
                if ($c['existed']) {
                    $this->scene->deleteFog($mapId, $floorId, $c['cx'], $c['cy']);
                    $rows = true;
                }
            } elseif ($c['existed']) {
                $this->scene->updateFog($mapId, $floorId, $c['cx'], $c['cy'], FogCodec::encode($c['raw']));
            } else {
                $this->scene->insertFog($mapId, $floorId, $c['cx'], $c['cy'], FogCodec::encode($c['raw']));
                $rows = true;
            }
            $diff = $reveal ? FogCodec::subtract($c['raw'], $c['old']) : FogCodec::subtract($c['old'], $c['raw']);
            if (!FogCodec::isEmpty($diff)) {
                $diffs[] = [$c['cx'], $c['cy'], $diff];
            }
        }
        $f->fog($floorId, $reveal ? 'reveal' : 'hide', $diffs);
        if ($rows) {
            $f->refreshScopes();
        }

        return $reveal ? ['ok' => true, 'rejected_bits' => $rejected] : ['ok' => true];
    }

    /**
     * D9 disks [x, y, vision.range + 1] of the visible tokens assigned to the player on the floor
     * (vision disabled: radius 1).
     *
     * @return list<array{0: float, 1: float, 2: float}>
     */
    private function disks(ActionScene $s, int $floorId): array
    {
        $out = [];
        foreach ($this->queries->assignedPlaced($s->ctx->session->id, $s->map->id) as $t) {
            if ($t['user_id'] !== $s->userId || $t['floor_id'] !== $floorId) {
                continue;
            }
            $enabled = ($t['vision']['enabled'] ?? true) === true;
            $range = $enabled && is_numeric($t['vision']['range'] ?? null) ? max(0.0, (float) $t['vision']['range']) : 0.0;
            $out[] = [$t['x'], $t['y'], $range + 1.0];
        }

        return $out;
    }
}
