<?php

declare(strict_types=1);

namespace JDR\Tests\Security;

use JDR\Domain\Sessions\EventFanout;
use JDR\Domain\Sessions\EventTypes;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\SessionsActions\ActionsTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Exhaustive anti-leak test (projet.md 10.2 "Note IA", contract P6 "Test exhaustif anti-fuite"):
 * a whole session is played through the API (every type of EventTypes::ALL is really written:
 * the test fails when one is not), with fog_strict on and off and players_see_other_pcs off,
 * then everything players A (Bob) and B (Dan) can read — the events through GET /events with
 * their own session, the snapshots, preloads, chunks and fog, in the middle and at the end — is
 * walked: no forbidden uid (layer gm, visibility gm / hidden_until_revealed before its reveal,
 * hidden tokens, tokens / objects outside the fog_strict scope, other PCs when hidden from
 * them), no "layer": "gm", "secret": true, "hidden": true, "visibility": "gm", no block outside
 * the scope, the secret door only ever as a wall. A non-member gets 404 everywhere, a kicked
 * player 403.
 * P7b: the "table" (projection screen paired before the session, ?as=display) is walked the same
 * way (events since 0, snapshot, preload, chunks, fog) with the hidden content forbidden and, under
 * fog_strict, what is outside the union of the viewers' scopes; it never gets session.code,
 * map.ops, player.*, display.paired nor a "player" / "gm" version. A screen of another session
 * gets 404 everywhere, a revoked screen 401.
 */
final class LeakTest extends ActionsTestCase
{
    use LeakScenario;

    /**
     * @return array<string, array{0: array<string, bool>}>
     */
    public static function modes(): array
    {
        return [
            'fog_strict' => [['fog_strict' => true, 'players_see_other_pcs' => true]],
            'fog_strict_off' => [['fog_strict' => false, 'players_see_other_pcs' => true]],
            'own_pcs_only' => [['fog_strict' => false, 'players_see_other_pcs' => false]],
            'strict_own_pcs_only' => [['fog_strict' => true, 'players_see_other_pcs' => false]],
        ];
    }

    #[DataProvider('modes')]
    public function testNothingHiddenReachesAPlayer(array $settings): void
    {
        $w = $this->playWholeSession($settings);
        $rules = $this->rules($w, $settings);

        // 1. Every event type is covered.
        $written = array_values(array_unique(array_column($this->events(), 'type')));
        $missing = array_values(array_diff(EventTypes::ALL, $written));
        self::assertSame([], $missing, 'event types of EventTypes::ALL not provoked by the scenario: ' . implode(', ', $missing));
        self::assertSame([], array_values(array_diff($written, EventTypes::ALL)), 'type written but missing from EventTypes::ALL');

        // 2. What each player reads from the event log, as a real client.
        $received = [];
        foreach (['bob', 'dan'] as $who) {
            foreach ($this->received($w[$who], $w['channel']) as $event) {
                $received[$event['type']] = true;
                $this->inspect($rules, $who, 'event #' . $event['id'] . ' ' . $event['type'], $event, (int) $event['id']);
            }
            self::assertSame(403, $w[$who]->get('/events?channels=map:' . $w['big'])->status(), 'map channel: GM only');
        }
        foreach ([EventTypes::SESSION_CODE, EventTypes::MAP_OPS, EventTypes::DISPLAY_PAIRED, EventTypes::DISPLAY_UPDATED, EventTypes::DISPLAY_REVOKED] as $gmOnly) {
            self::assertArrayNotHasKey($gmOnly, $received);
        }
        foreach ([EventTypes::TOKEN_MOVED, EventTypes::TOKEN_ADDED, EventTypes::TOKEN_REMOVED, EventTypes::OBJECT_REVEALED,
            EventTypes::DOOR_TOGGLED, EventTypes::LIGHT_CHANGED, EventTypes::FOG_UPDATED, EventTypes::MAP_OPS_PUBLIC] as $type) {
            self::assertArrayHasKey($type, $received, $type . ': the players get their version');
        }

        // 2b. What the table (projection screen) reads from the event log.
        $table = [];
        foreach ($this->receivedAsDisplay($w['table'], $w['channel']) as $event) {
            $table[$event['type']] = true;
            $this->inspect($rules, 'table', 'event #' . $event['id'] . ' ' . $event['type'], $event, (int) $event['id']);
            self::assertNotContains($event['payload']['view'] ?? null, [EventFanout::VIEW_PLAYER, EventFanout::VIEW_GM], 'table: ' . $event['type']);
            self::assertStringStartsNotWith('player.', $event['type'], 'table: player events');
        }
        foreach ([EventTypes::SESSION_CODE, EventTypes::MAP_OPS, EventTypes::DISPLAY_PAIRED] as $gmOnly) {
            self::assertArrayNotHasKey($gmOnly, $table, 'table: ' . $gmOnly);
        }
        foreach ([EventTypes::TOKEN_MOVED, EventTypes::TOKEN_ADDED, EventTypes::TOKEN_REMOVED, EventTypes::OBJECT_REVEALED, EventTypes::DOOR_TOGGLED,
            EventTypes::LIGHT_CHANGED, EventTypes::FOG_UPDATED, EventTypes::MAP_OPS_PUBLIC, EventTypes::CAMERA_MOVED] as $type) {
            self::assertArrayHasKey($type, $table, $type . ': the table gets its version');
        }
        self::assertSame(403, $w['table']->get('/events?as=display&channels=map:' . $w['big'])->status(), 'map channel: GM only');

        // 3. Snapshots, preload, chunks, fog at the end (the mid-session ones were checked by playWholeSession()).
        $this->inspectReads($w, $rules, 'end');

        // 4. Outsider and kicked player.
        $this->assertLockedOut($w);
    }

    /**
     * Reads of $who: snapshot, preload, chunks (binary), fog.
     *
     * @param array<string, mixed> $w
     * @param array<string, mixed> $rules
     */
    protected function inspectReads(array $w, array $rules, string $when): void
    {
        $at = $this->head();
        foreach (['bob', 'dan', 'table'] as $who) {
            /** @var ApiClient $client */
            $client = $w[$who];
            $as = static fn (string $path): string => $who === 'table' ? $path . (str_contains($path, '?') ? '&' : '?') . 'as=display' : $path;
            $snapshot = self::data($this->ok($client->get($as('/sessions/' . $w['session'] . '/snapshot'))));
            if ($who === 'table') {
                self::assertArrayNotHasKey('code', $snapshot['session'], $when . ' table: no code');
                self::assertSame([], $snapshot['session']['players'], $when . ' table: no players');
                self::assertSame('display', $snapshot['session']['role']);
                self::assertContains('t-free', $snapshot['viewers'], $when . ' table: a free PC is a viewer');
            }
            $this->inspect($rules, $who, $when . ' snapshot', $snapshot, $at);
            foreach ($snapshot['fog']['chunks'] as [$cx, $cy]) {
                $this->inspectBlock($rules, $who, $when . ' snapshot fog', (int) $snapshot['fog']['floor'], $cx, $cy, $at);
            }
            $preload = self::data($this->ok($client->get($as('/sessions/' . $w['session'] . '/preload'))));
            $this->inspect($rules, $who, $when . ' preload', $preload, $at);
            foreach ($rules['assets'][$who] ?? [] as $assetId) {
                self::assertNotContains($assetId, array_column($preload['assets'], 'id'), $when . ' preload ' . $who);
            }
            $fog = self::data($this->ok($client->get($as('/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor']))));
            foreach ($fog['chunks'] as [$cx, $cy]) {
                $this->inspectBlock($rules, $who, $when . ' fog', (int) $w['bigFloor'], $cx, $cy, $at);
            }
            $chunks = $this->ok($client->get($as('/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'])));
            foreach (self::parseChunks($chunks->body()) as $c) {
                $this->inspectBlock($rules, $who, $when . ' chunks', (int) $w['bigFloor'], $c['cx'], $c['cy'], $at);
            }
        }
    }

    /**
     * @param array<string, mixed> $w
     */
    private function assertLockedOut(array $w): void
    {
        $base = '/sessions/' . $w['session'];
        $reads = [$base, $base . '/snapshot', $base . '/preload', '/maps/' . $w['big'], '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'],
            '/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'], '/events?channels=' . $w['channel'], '/events?channels=map:' . $w['big']];
        foreach ($reads as $path) {
            $r = $w['eve']->get($path);
            self::assertSame(404, $r->status(), 'outsider ' . $path);
            self::assertStringNotContainsString('wall', $r->body());
        }
        self::assertSame(404, $this->act($w['eve'], $w['session'], [self::move('t-elf', 6, 6)])->status());
        foreach ([$base . '/snapshot', $base . '/preload', '/events?channels=' . $w['channel']] as $path) {
            self::assertSame(403, $w['kim']->get($path)->status(), 'kicked ' . $path);
        }
        // P7b: a screen of another session (404) and a revoked screen (401) read nothing.
        $screenReads = [$base . '/snapshot?as=display', $base . '/preload?as=display', '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'] . '&as=display',
            '/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'] . '&as=display', '/events?as=display&channels=' . $w['channel'], '/stream?as=display&channels=' . $w['channel']];
        foreach ([['otherScreen', 404], ['revokedScreen', 401]] as [$who, $status]) {
            foreach ($screenReads as $path) {
                $r = $w[$who]->get($path);
                self::assertSame($status, $r->status(), $who . ' ' . $path);
                self::assertStringNotContainsString('wall', $r->body());
            }
        }
        // The table reaches no other route (no user: 401).
        foreach ([$base . '?as=display', '/maps/' . $w['big'] . '?as=display', '/maps/' . $w['big'] . '/objects?floor=' . $w['bigFloor'] . '&as=display'] as $path) {
            self::assertSame(401, $w['table']->get($path)->status(), 'table ' . $path);
        }
    }

    /**
     * Events a projection screen reads (GET /events?as=display, wait=0) since 0.
     *
     * @return list<array<string, mixed>>
     */
    private function receivedAsDisplay(ApiClient $client, string $channels): array
    {
        $out = [];
        $since = 0;
        do {
            $data = self::data($this->ok($client->get('/events?as=display&channels=' . rawurlencode($channels) . '&since=' . $since . '&wait=0')));
            foreach ($data['events'] as $e) {
                $out[] = $e;
            }
            $since = (int) $data['last_id'];
        } while (count($data['events']) === 500);

        return $out;
    }

    /**
     * Walks a JSON-able value read by $who at event id / head $at.
     *
     * @param array<string, mixed> $rules
     */
    private function inspect(array $rules, string $who, string $where, mixed $value, int $at): void
    {
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        self::assertIsString($json);
        foreach ($rules['needles'] as [$players, $needle, $until]) {
            if (in_array($who, $players, true) && $at <= $until) {
                self::assertFalse(str_contains($json, '"' . $needle . '"'), $who . ' / ' . $where . ': ' . $needle);
            }
        }
        $data = json_decode($json, true);
        $this->walk($rules, $who, $where, $data, $at);
        if (is_array($data) && isset($data['type'], $data['payload']) && is_array($data['payload'])) {
            $p = $data['payload'];
            if ($data['type'] === EventTypes::MAP_OPS_PUBLIC) {
                foreach ($p['chunks'] as [$floor, $cx, $cy]) {
                    $this->inspectBlock($rules, $who, $where, (int) $floor, $cx, $cy, $at);
                }
            } elseif ($data['type'] === EventTypes::FOG_UPDATED) {
                foreach ($p['chunks'] as [$cx, $cy]) {
                    $this->inspectBlock($rules, $who, $where, (int) $p['floor_id'], $cx, $cy, $at);
                }
            } elseif ($data['type'] === EventTypes::DOOR_TOGGLED) {
                self::assertNotSame('door-secret', $p['uid'], $where . ': the secret door is a wall');
            }
        }
    }

    /**
     * @param array<string, mixed> $rules
     */
    private function walk(array $rules, string $who, string $where, mixed $node, int $at): void
    {
        if (!is_array($node)) {
            return;
        }
        $at_ = $where . ' (' . $who . ')';
        self::assertNotSame('gm', $node['layer'] ?? null, $at_ . ': layer gm');
        self::assertNotSame(true, $node['secret'] ?? null, $at_ . ': secret');
        self::assertNotSame(true, $node['hidden'] ?? null, $at_ . ': hidden');
        self::assertNotSame('gm', $node['visibility'] ?? null, $at_ . ': visibility gm');
        if (($node['visibility'] ?? null) === 'hidden_until_revealed') {
            self::assertTrue(($node['uid'] ?? null) === 'hidden-vis' && $at > $rules['revealed_at'], $at_ . ': hidden_until_revealed before its reveal');
        }
        if (($node['uid'] ?? null) === 'door-secret' && isset($node['type'])) {
            self::assertSame('wall', $node['type'], $at_ . ': secret door');
        }
        foreach ($node as $child) {
            $this->walk($rules, $who, $where, $child, $at);
        }
    }

    /**
     * @param array<string, mixed> $rules
     */
    private function inspectBlock(array $rules, string $who, string $where, int $floor, int $cx, int $cy, int $at): void
    {
        foreach ($rules['blocks'] as [$players, $bx, $by, $until]) {
            if (in_array($who, $players, true) && $at <= $until) {
                self::assertFalse($floor === $rules['floor'] && $cx === $bx && $cy === $by, $who . ' / ' . $where . ': block ' . $cx . ':' . $cy);
            }
        }
    }
}
