<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Maps\FogCodec;
use JDR\Realtime\Audience;
use JDR\Realtime\Channel;

/**
 * Fan-out of the map-content changes of one request (EventFanout, D4 / D5). Each change is
 * written as a gm event (by the caller, gm()) and as player versions computed here (PlayerSight),
 * player by player, against the fog_strict scope read when the batch began (before the changes):
 * - a placed token: maptoken.added (it appears), maptoken.removed {uid} (it disappears) or the
 *   given "changed" type (maptoken.moved / maptoken.updated);
 * - an object: the given type (door.toggled, light.changed, object.revealed) when the player's
 *   version changed; map.ops.public for the ops of the editor (D10);
 * - fog bits: fog.updated with the blocks of the scope.
 * When a scope changes (a token of a player moved, a fog block appeared or disappeared),
 * refreshScopes() sends what entered / left it: map.ops.public {objects, chunks: new blocks} and
 * maptoken.added / maptoken.removed. With fog_strict off, an event that is the same for every
 * player is written once for the audience "players".
 * P7b D6: when the session has an active projection screen, the same versions are computed for the
 * virtual player "table" (TableAudience: every table viewer is his, scope FogStrictScope::forTable)
 * and written for the audience "displays" (payload.view = "display"); camera.moved too.
 */
final class FanoutBatch
{
    /** @var array<int, FogScope> by user id, scopes of the players before the pending changes */
    private array $scopes = [];
    private int $revision;
    private ScopeDiff $diff;

    /**
     * @param list<int> $players non-kicked players of the session
     */
    public function __construct(
        private EventFanout $fanout,
        private FogStrictScope $scopeService,
        private PlayerSight $sight,
        private MapSceneRepository $scene,
        private SessionContext $ctx,
        private Map $map,
        private array $players,
        private ?int $actor,
        private ?string $opId,
        private ?TableAudience $table = null,
    ) {
        $this->revision = $map->revision;
        $this->diff = new ScopeDiff($scene, $map);
        if ($this->restricted()) {
            $this->scopes = $this->scopeService->forUsers($ctx, $map->id, $players);
        }
    }

    public function running(): bool
    {
        return $this->ctx->session->state === Session::RUNNING;
    }

    public function setRevision(int $revision): void
    {
        $this->revision = $revision;
    }

    /** The complete version (audience gm, payload.view = gm). */
    public function gm(string $type, array $payload, bool $ephemeral = false): void
    {
        $this->emit($type, Audience::GM, $payload + ['view' => EventFanout::VIEW_GM], null, $ephemeral);
    }

    /** An event for everyone ("all"), gm only while paused (D5). */
    public function everyone(string $type, array $payload): void
    {
        $this->emit($type, $this->running() ? Audience::ALL : Audience::GM, $payload);
    }

    /** An event for the players ("players") and the screens ("displays"), gm only while paused (D5). */
    public function players(string $type, array $payload, bool $ephemeral = false): void
    {
        $this->emit($type, $this->running() ? Audience::PLAYERS : Audience::GM, $payload, null, $ephemeral);
        if ($this->running()) {
            $this->table?->raw($type, $payload, $ephemeral);
        }
    }

    /** An event for everyone even while paused (note.read_aloud). */
    public function always(string $type, array $payload): void
    {
        $this->emit($type, Audience::ALL, $payload);
    }

    /**
     * Player versions of a placed-token change (API forms; null = absent).
     *
     * @param array<string, mixed>|null $before
     * @param array<string, mixed>|null $after
     */
    public function token(?array $before, ?array $after, string $changedType): void
    {
        $uid = (string) ($after['uid'] ?? $before['uid'] ?? '');
        $this->sight->tokenChanged($uid, $after);
        $this->table?->sight()->tokenChanged($uid, $after);
        $this->dispatch(static function (PlayerSight $sight, int $user, FogScope $scope) use ($before, $after, $changedType): array {
            $vb = $before === null ? null : $sight->token($before, $user, $scope);
            $va = $after === null ? null : $sight->token($after, $user, $scope);
            if ($vb === $va) {
                return [];
            }
            if ($va === null) {
                return [[EventTypes::TOKEN_REMOVED, ['uid' => (string) $vb['uid']]]];
            }
            if ($vb === null) {
                return [[EventTypes::TOKEN_ADDED, $va]];
            }

            return [[$changedType, $changedType === EventTypes::TOKEN_MOVED ? self::moved($va) : $va]];
        });
        if ($this->table?->ownRefresh($before, $after) === true) {
            $this->refreshTable();
        }
    }

    /**
     * Player versions of an object change: $type with $payload(version of the player) when the
     * player's version is present and differs from the one before (rev aside: a secret door seen
     * as a wall does not change for the player when the door is toggled); $payload may return
     * null (nothing to say about that version).
     *
     * @param array<string, mixed>|null                              $before
     * @param array<string, mixed>                                   $after
     * @param \Closure(array<string, mixed>): ?array<string, mixed>  $payload
     */
    public function object(?array $before, array $after, string $type, \Closure $payload): void
    {
        $this->dispatch(static function (PlayerSight $sight, int $user, FogScope $scope) use ($before, $after, $type, $payload): array {
            $vb = $before === null ? null : $sight->object($before, $scope);
            $va = $sight->object($after, $scope);
            if ($va === null || ($vb !== null && array_diff_key($va, ['rev' => 0]) === array_diff_key($vb, ['rev' => 0]))) {
                return [];
            }
            $out = $payload($va);

            return $out === null ? [] : [[$type, $out]];
        });
    }

    /**
     * object.revealed for the players whose version of the object changes when it is revealed
     * (hidden_until_revealed object appearing, secret door no longer a wall); marks it revealed.
     *
     * @param array<string, mixed> $object
     */
    public function reveal(array $object): void
    {
        $this->dispatch(static function (PlayerSight $sight, int $user, FogScope $scope) use ($object): array {
            $vb = $sight->object($object, $scope, false);
            $va = $sight->object($object, $scope, true);

            return $va === null || $va === $vb ? [] : [[EventTypes::OBJECT_REVEALED, $va]];
        });
        $this->sight->markRevealed((string) $object['uid']);
        $this->table?->sight()->markRevealed((string) $object['uid']);
    }

    /**
     * D10: map.ops.public {map_id, revision, objects: {upsert, remove}, chunks: [[floor, cx, cy]], reload}.
     *
     * @param list<array{0: array<string, mixed>|null, 1: array<string, mixed>|null}> $objects [before, after]
     * @param list<array{0: int, 1: int, 2: int}>                                     $blocks  touched tile blocks
     */
    public function mapOps(array $objects, array $blocks, bool $reload): void
    {
        $this->dispatch(function (PlayerSight $sight, int $user, FogScope $scope) use ($objects, $blocks, $reload): array {
            $upsert = [];
            $remove = [];
            foreach ($objects as [$before, $after]) {
                $vb = $before === null ? null : $sight->object($before, $scope);
                $va = $after === null ? null : $sight->object($after, $scope);
                if ($va !== null && $va !== $vb) {
                    $upsert[] = $va;
                } elseif ($va === null && $vb !== null) {
                    $remove[] = (string) $vb['uid'];
                }
            }
            $chunks = array_values(array_filter($blocks, static fn (array $b): bool => $scope->allowsBlock($b[0], $b[1], $b[2])));

            return $upsert === [] && $remove === [] && $chunks === [] && !$reload ? [] : [[EventTypes::MAP_OPS_PUBLIC, $this->opsPayload($upsert, $remove, $chunks, $reload)]];
        });
    }

    /**
     * fog.updated: complete for the GM ($gm; D10 leaves it to map.ops), the blocks of his scope
     * for each player.
     *
     * @param list<array{0: int, 1: int, 2: string}> $chunks [cx, cy, raw changed bits]
     */
    public function fog(int $floorId, string $op, array $chunks, bool $gm = true): void
    {
        if ($chunks === []) {
            return;
        }
        $wire = static fn (array $list): array => array_map(
            static fn (array $c): array => [$c[0], $c[1], base64_encode(FogCodec::encode($c[2]))],
            $list,
        );
        $base = ['map_id' => $this->map->id, 'floor_id' => $floorId, 'op' => $op];
        if ($gm) {
            $this->gm(EventTypes::FOG_UPDATED, $base + ['chunks' => $wire($chunks)]);
        }
        $this->dispatch(static function (PlayerSight $sight, int $user, FogScope $scope) use ($floorId, $chunks, $base, $wire): array {
            $mine = array_values(array_filter($chunks, static fn (array $c): bool => $scope->allowsBlock($floorId, $c[0], $c[1])));

            return $mine === [] ? [] : [[EventTypes::FOG_UPDATED, $base + ['chunks' => $wire($mine)]]];
        });
    }

    /**
     * Reads the scopes again (after a change of the assigned tokens or of the explored blocks)
     * and sends to each player (and to the table) what entered or left his scope.
     */
    public function refreshScopes(): void
    {
        if (!$this->ctx->fogStrict()) {
            return;
        }
        $tokens = null;
        $this->refreshTable($tokens);
        if ($this->players === []) {
            return;
        }
        $old = $this->scopes;
        $new = $this->scopeService->forUsers($this->ctx, $this->map->id, $this->players);
        $this->scopes = $new;
        if (!$this->running()) {
            return;
        }
        foreach ($this->players as $user) {
            foreach ($this->diff->changes($this->sight, $user, $old[$user], $new[$user], $this->revision, $tokens) as [$type, $payload]) {
                $this->emit($type, Audience::USER, $payload + ['view' => EventFanout::VIEW_PLAYER], $user);
            }
        }
    }

    /**
     * maptoken.moved payload: {uid, x, y, rotation, floor}.
     *
     * @param array<string, mixed> $token
     * @return array<string, mixed>
     */
    public static function moved(array $token): array
    {
        return ['uid' => (string) $token['uid'], 'x' => $token['x'], 'y' => $token['y'], 'rotation' => $token['rotation'], 'floor' => (string) $token['floor']];
    }

    // ---- Internals --------------------------------------------------------------------------

    /**
     * Reads the table scope again and sends to the screens what entered or left it.
     *
     * @param list<array<string, mixed>>|null $tokens placed tokens of the map (read once)
     */
    private function refreshTable(?array &$tokens = null): void
    {
        if ($this->table === null || !$this->ctx->fogStrict()) {
            return;
        }
        [$old, $new] = $this->table->rescope();
        if ($this->running()) {
            $this->table->emit($this->diff->changes($this->table->sight(), TableView::USER, $old, $new, $this->revision, $tokens));
        }
    }

    private function restricted(): bool
    {
        return $this->ctx->fogStrict() && $this->players !== [];
    }

    /**
     * Writes the player versions given by $eventsFor(sight, user, scope) => [[type, payload], ...]
     * (nothing while paused, D5). fog_strict off and the same events for every player: written
     * once for the audience "players". The table version (P7b) is written for "displays".
     *
     * @param \Closure(PlayerSight, int, FogScope): list<array{0: string, 1: array<string, mixed>}> $eventsFor
     */
    private function dispatch(\Closure $eventsFor): void
    {
        if (!$this->running()) {
            return;
        }
        if ($this->table !== null) {
            $this->table->emit($eventsFor($this->table->sight(), TableView::USER, $this->table->scope()));
        }
        $player = ['view' => EventFanout::VIEW_PLAYER];
        if (!$this->ctx->fogStrict()) {
            $open = FogScope::unrestricted();
            $common = $eventsFor($this->sight, 0, $open);
            $own = [];
            foreach ($this->players as $user) {
                $own[$user] = $eventsFor($this->sight, $user, $open);
            }
            if (array_filter($own, static fn (array $e): bool => $e !== $common) === []) {
                foreach ($common as [$type, $payload]) {
                    $this->emit($type, Audience::PLAYERS, $payload + $player);
                }

                return;
            }
            foreach ($own as $user => $events) {
                foreach ($events as [$type, $payload]) {
                    $this->emit($type, Audience::USER, $payload + $player, $user);
                }
            }

            return;
        }
        foreach ($this->players as $user) {
            foreach ($eventsFor($this->sight, $user, $this->scopes[$user] ?? FogScope::of([])) as [$type, $payload]) {
                $this->emit($type, Audience::USER, $payload + $player, $user);
            }
        }
    }

    /**
     * @param list<array<string, mixed>>        $upsert
     * @param list<string>                      $remove
     * @param list<array{0: int, 1: int, 2: int}> $chunks
     * @return array<string, mixed>
     */
    private function opsPayload(array $upsert, array $remove, array $chunks, bool $reload): array
    {
        return ScopeDiff::opsPayload($this->map->id, $this->revision, $upsert, $remove, $chunks, $reload);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function emit(string $type, string $audience, array $payload, ?int $user = null, bool $ephemeral = false): void
    {
        $this->fanout->record(Channel::session($this->ctx->session->id), $type, $audience, $payload, $user, $this->actor, $this->opId, $ephemeral);
    }
}
