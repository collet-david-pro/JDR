<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Sessions\EventTypes;
use JDR\Domain\Sessions\FanoutBatch;
use JDR\Domain\Sessions\SessionRepository;
use JDR\Maps\Collision;
use JDR\Maps\ObjectRules;
use JDR\Maps\PlayerFilter;

/**
 * Applies the resolved actions of a batch (contract P6 "Actions de séance"), in order, each one
 * persisted and fanned out (FanoutBatch) in the transaction of the batch:
 * - token.move: collision D8 for a player when players_blocked_by_walls (against the objects he
 *   sees); map_tokens + rev;
 *   maptoken.moved (gm + D4); the scopes are read again when the token is assigned;
 * - door.toggle / light.toggle: props.state / props.enabled + rev; door.toggled / light.changed;
 * - reveal: object => revealed_at (object.revealed), token => hidden = false (maptoken.updated
 *   for the GM, maptoken.added for the players who see it);
 * - camera.set: play_sessions.camera, camera.moved (players, ephemeral, D3);
 * - ambient.set: maps.ambient (same rules as map.meta ambient), ambient.changed;
 * - note.show: note.read_aloud only;
 * - fog.reveal / fog.hide: FogActions.
 * Result of an action: {index, ok: true, ...} or {index, ok: false, error: "blocked_by_wall",
 * position: {x, y}} (the token stopped at the last valid point).
 */
final class ActionHandlers
{
    public function __construct(
        private MapSceneRepository $scene,
        private MapRepository $maps,
        private SessionRepository $sessions,
        private FogActions $fog,
        private Db $db,
        private Clock $clock,
    ) {
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    public function apply(ActionScene $s, FanoutBatch $f, array $a, int $index): array
    {
        $result = match ($a['type']) {
            'token.move' => $this->move($s, $f, $a),
            'door.toggle' => $this->door($s, $f, $a),
            'light.toggle' => $this->light($s, $f, $a),
            'reveal' => $a['kind'] === 'token' ? $this->revealToken($s, $f, $a) : $this->revealObject($s, $f, $a),
            'fog.reveal', 'fog.hide' => $this->fog->apply($s, $f, $a),
            'camera.set' => $this->camera($s, $f, $a),
            'ambient.set' => $this->ambient($s, $f, $a),
            default => $this->note($f, $a),
        };

        return ['index' => $index] + $result;
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function move(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $entry = $s->tokens[$a['uid']];
        $before = $entry['token'];
        $x = (float) $a['x'];
        $y = (float) $a['y'];
        $blocked = false;
        if (!$s->isGm() && $s->ctx->setting('players_blocked_by_walls')) {
            $def = $s->definitions[(int) $before['token_id']] ?? ['size_w' => 1.0, 'size_h' => 1.0];
            $r = Collision::radius($def['size_w'], $def['size_h'], (float) $before['scale']);
            $hit = Collision::move(
                $this->segments($s, (int) $before['floor'], (float) $before['x'], (float) $before['y'], $x, $y, $r),
                (float) $before['x'],
                (float) $before['y'],
                $x,
                $y,
                $r,
            );
            $blocked = $hit['blocked'];
            $x = max(0.0, min((float) $s->map->width, $hit['x']));
            $y = max(0.0, min((float) $s->map->height, $hit['y']));
        }
        $after = $before;
        $after['x'] = MapSceneRepository::num($x);
        $after['y'] = MapSceneRepository::num($y);
        if ($a['rotation'] !== null) {
            $after['rotation'] = $a['rotation'];
        }
        if ($after['x'] !== $before['x'] || $after['y'] !== $before['y'] || $after['rotation'] !== $before['rotation']) {
            $after['rev'] = $before['rev'] + 1;
            $this->scene->updateToken($entry['id'], $after);
            $s->tokens[$a['uid']]['token'] = $after;
            $f->gm(EventTypes::TOKEN_MOVED, FanoutBatch::moved($after));
            $f->token($before, $after, EventTypes::TOKEN_MOVED);
            if (isset($s->assignments[(int) $after['token_id']])) {
                $f->refreshScopes();
            }
        }
        if ($blocked) {
            return ['ok' => false, 'error' => 'blocked_by_wall', 'position' => ['x' => $after['x'], 'y' => $after['y']]];
        }

        return ['ok' => true, 'uid' => (string) $after['uid'], 'x' => $after['x'], 'y' => $after['y'], 'rotation' => $after['rotation']];
    }

    /**
     * Movement-blocking segments of a floor around the move, from the objects as the player sees
     * them (PlayerFilter: what is hidden from him does not stop him - it would betray it -, a
     * secret door not revealed is a wall), like the prediction of his client.
     *
     * @return list<array{0: float, 1: float, 2: float, 3: float}>
     */
    private function segments(ActionScene $s, int $floorId, float $px, float $py, float $qx, float $qy, float $r): array
    {
        $margin = $r + 2.0;
        $box = [min($px, $qx) - $margin, min($py, $qy) - $margin, max($px, $qx) + $margin, max($py, $qy) + $margin];
        $revealed = $this->scene->revealedUids($s->map->id);
        $objects = array_values(array_filter(
            PlayerFilter::objects($this->scene->objects($s->map->id, $floorId, $box), $revealed),
            static fn (array $o): bool => in_array($o['type'], ['wall', 'door', 'window'], true),
        ));

        return Collision::segments($objects, array_fill_keys($revealed, true));
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function door(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $before = $s->objects[$a['uid']]['object'];
        $state = $a['state'] ?? ($before['props']['state'] === 'open' ? 'closed' : 'open');
        $this->updateProps($s, $a['uid'], 'state', $state, function (array $before, array $after) use ($f): void {
            $f->gm(EventTypes::DOOR_TOGGLED, ['uid' => (string) $after['uid'], 'state' => $after['props']['state']]);
            $f->object($before, $after, EventTypes::DOOR_TOGGLED, static fn (array $v): ?array => $v['type'] !== 'door' ? null : [
                'uid' => (string) $v['uid'],
                'state' => $v['props']['state'],
            ]);
        });

        return ['ok' => true, 'uid' => (string) $before['uid'], 'state' => $state];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function light(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $before = $s->objects[$a['uid']]['object'];
        $enabled = $a['enabled'] ?? $before['props']['enabled'] !== true;
        $this->updateProps($s, $a['uid'], 'enabled', $enabled, function (array $before, array $after) use ($f): void {
            $f->gm(EventTypes::LIGHT_CHANGED, $after);
            $f->object($before, $after, EventTypes::LIGHT_CHANGED, static fn (array $v): array => $v);
        });

        return ['ok' => true, 'uid' => (string) $before['uid'], 'enabled' => $enabled];
    }

    /**
     * props[$key] = $value, rev + 1, then $notify(before, after) (nothing when unchanged).
     *
     * @param \Closure(array<string, mixed>, array<string, mixed>): void $notify
     */
    private function updateProps(ActionScene $s, string $uid, string $key, mixed $value, \Closure $notify): void
    {
        $entry = $s->objects[$uid];
        $before = $entry['object'];
        if ($before['props'][$key] === $value) {
            return;
        }
        $after = $before;
        $after['props'][$key] = $value;
        $after['rev'] = $before['rev'] + 1;
        $after = ObjectRules::canonical($after);
        $this->scene->updateObject($entry['id'], $after, ObjectRules::bbox($after, $s->map->width, $s->map->height));
        $s->objects[$uid]['object'] = $after;
        $notify($before, $after);
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function revealObject(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $entry = $s->objects[$a['uid']];
        $object = $entry['object'];
        $done = $this->db->execute(
            'UPDATE ' . $this->db->t('map_objects') . ' SET `revealed_at` = ?, `updated_at` = ? WHERE `id` = ? AND `revealed_at` IS NULL',
            [$this->clock->sql(), $this->clock->sql(), $entry['id']],
        );
        if ($done > 0) {
            $f->gm(EventTypes::OBJECT_REVEALED, $object);
            $f->reveal($object);
        }

        return ['ok' => true, 'kind' => 'object', 'uid' => (string) $object['uid']];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function revealToken(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $entry = $s->tokens[$a['uid']];
        $before = $entry['token'];
        if ($before['hidden'] === true) {
            $after = array_replace($before, ['hidden' => false, 'rev' => $before['rev'] + 1]);
            $this->scene->updateToken($entry['id'], $after);
            $s->tokens[$a['uid']]['token'] = $after;
            $f->gm(EventTypes::TOKEN_UPDATED, $after);
            $f->token($before, $after, EventTypes::TOKEN_UPDATED);
            if (isset($s->assignments[(int) $after['token_id']])) {
                $f->refreshScopes();
            }
        }

        return ['ok' => true, 'kind' => 'token', 'uid' => (string) $before['uid']];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function camera(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $floor = $a['floor_id'] ?? $s->ctx->session->currentFloorId ?? ($s->floorIds[0] ?? null);
        $camera = ['x' => $a['x'], 'y' => $a['y'], 'zoom' => $a['zoom'], 'floor_id' => $floor, 'follow' => $a['follow']];
        $this->sessions->update($s->ctx->session->id, ['camera' => $camera]);
        $f->players(EventTypes::CAMERA_MOVED, $camera, true);

        return ['ok' => true, 'camera' => $camera];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function ambient(ActionScene $s, FanoutBatch $f, array $a): array
    {
        $errors = [];
        $ambient = MapInput::ambient($a['ambient'], $s->ambient, 'ambient', $errors) ?? $s->ambient;
        if ($ambient !== $s->ambient) {
            $s->ambient = $ambient;
            $this->maps->update($s->map->id, ['ambient' => $ambient]);
            $f->everyone(EventTypes::AMBIENT_CHANGED, ['ambient' => $ambient]);
        }

        return ['ok' => true, 'ambient' => $ambient];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private function note(FanoutBatch $f, array $a): array
    {
        $f->always(EventTypes::NOTE_READ_ALOUD, ['title' => $a['title'], 'body' => $a['body']]);

        return ['ok' => true];
    }
}
