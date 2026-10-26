<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * D10: POST /maps/{id}/ops on the current map of a running / paused session writes map.ops (gm,
 * channel map:{id}) and the filtered player versions (map.ops.public, maptoken.*, fog.updated,
 * ambient.changed) in the same transaction; paused: map.ops only; no session: nothing.
 */
final class MapOpsBroadcastTest extends ActionsTestCase
{
    /**
     * @return list<array<string, mixed>>
     */
    private function publicOps(array $w, string $who, int $since): array
    {
        return array_values(array_map(
            static fn (array $e): array => $e['payload'],
            array_filter($this->received($w[$who], $w['channel'], $since), static fn (array $e): bool => $e['type'] === 'map.ops.public'),
        ));
    }

    public function testNoOpenSessionNoEvent(): void
    {
        $w = $this->bigScene(false);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'object.add', 'object' => self::wallObject('w-x', $w['bigFloor'], [[3, 8], [4, 8]])]]);
        self::assertSame($head, $this->head(), 'lobby: not played');
    }

    public function testObjectsAndTilesAreFilteredForThePlayers(): void
    {
        $w = $this->bigScene();
        $f = $w['bigFloor'];
        $head = $this->head();
        $result = $this->opsOk($w['gm'], $w['big'], [
            ['type' => 'object.add', 'object' => self::wallObject('w-near', $f, [[3, 8], [4, 8]])],
            ['type' => 'object.add', 'object' => self::wallObject('w-secret', $f, [[3, 9], [4, 9]], ['layer' => 'gm'])],
            ['type' => 'object.add', 'object' => self::wallObject('w-far', $f, [[150, 150], [151, 150]])],
            self::tiles($f, 'ground', [[4, 4, 1], [140, 140, 1]]),
        ]);
        $mapEvents = $this->events($head, 'map:' . $w['big']);
        self::assertCount(1, $mapEvents);
        self::assertSame('map.ops', $mapEvents[0]['type']);
        self::assertSame('gm', $mapEvents[0]['audience']);
        self::assertSame($result['revision'], (int) $mapEvents[0]['payload']['revision']);
        self::assertCount(4, $mapEvents[0]['payload']['ops']);
        self::assertSame((string) $this->userId('Alice'), $mapEvents[0]['payload']['actor']);

        foreach (['bob', 'dan'] as $who) {
            $ops = $this->publicOps($w, $who, $head);
            self::assertCount(1, $ops, $who);
            self::assertSame(['w-near'], array_column($ops[0]['objects']['upsert'], 'uid'), $who);
            self::assertSame([], $ops[0]['objects']['remove']);
            self::assertSame([[$f, 0, 0]], $ops[0]['chunks'], 'only the touched blocks of his scope');
            self::assertFalse($ops[0]['reload']);
            self::assertSame($result['revision'], (int) $ops[0]['revision']);
        }
        // The GM reads map.ops on the map channel; a player may not.
        self::assertSame(['map.ops'], $this->receivedTypes($w['gm'], 'map:' . $w['big'], $head));
        self::assertSame(403, $w['bob']->get('/events?channels=map:' . $w['big'] . '&since=0')->status());
    }

    public function testVisibilityChangesAddAndRemove(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'object.update', 'uid' => 'wall-near', 'rev' => 1, 'patch' => ['visibility' => 'gm']]]);
        self::assertSame(['wall-near'], $this->publicOps($w, 'bob', $head)[0]['objects']['remove']);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'object.update', 'uid' => 'gm-vis', 'rev' => 1, 'patch' => ['visibility' => 'all']]]);
        self::assertSame(['gm-vis'], array_column($this->publicOps($w, 'bob', $head)[0]['objects']['upsert'], 'uid'));
        // Removing an object the players never had: no word of it.
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'object.remove', 'uid' => 'gm-layer']]);
        self::assertSame([], $this->publicOps($w, 'bob', $head));
        self::assertSame(['map.ops/gm'], $this->kinds($head));
    }

    public function testTokensFogAndAmbient(): void
    {
        $w = $this->bigScene();
        $f = $w['bigFloor'];
        $gob = $this->newToken($w['gm'], $w['game'], ['name' => 'Rat', 'kind' => 'monster']);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [
            ['type' => 'maptoken.add', 'token' => self::placedToken('t-rat', $f, (string) $gob['id'], 7, 7)],
            ['type' => 'maptoken.add', 'token' => self::placedToken('t-ghost', $f, (string) $gob['id'], 7, 8, ['hidden' => true])],
            ['type' => 'maptoken.update', 'uid' => 't-goblin', 'rev' => 1, 'patch' => ['hidden' => true]],
            ['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[0, 0, self::b64(self::fogBits(0, 0, 1, 1, 3, 3))]]],
            ['type' => 'map.meta', 'ambient' => ['darkness' => 0.7]],
        ]);
        $bob = $this->received($w['bob'], $w['channel'], $head);
        $types = array_column($bob, 'type');
        self::assertSame(['maptoken.removed', 'maptoken.added', 'fog.updated', 'ambient.changed'], $types);
        self::assertSame('t-goblin', $bob[0]['payload']['uid'], 'hidden now');
        self::assertSame('t-rat', $bob[1]['payload']['uid']);
        self::assertSame('reveal', $bob[2]['payload']['op']);
        self::assertEqualsWithDelta(0.7, $bob[3]['payload']['ambient']['darkness'], 1e-9);
        self::assertStringNotContainsString('t-ghost', json_encode($bob));
        // Position change of a visible token: maptoken.updated.
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'maptoken.update', 'uid' => 't-rat', 'rev' => 1, 'patch' => ['x' => 8]]]);
        self::assertSame(['maptoken.updated'], $this->receivedTypes($w['bob'], $w['channel'], $head));
    }

    public function testFogStrictOffAndReload(): void
    {
        $w = $this->bigScene();
        $this->setSettings($w, ['fog_strict' => false]);
        $c = $this->uploadOk($w['gm'], 'valid_webp_lossless.webp', ['kind' => 'tile']);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [self::paletteAdd(3, $c['id']), self::tiles($w['bigFloor'], 'ground', [[140, 140, 3]])]);
        self::assertSame(['map.ops.public/players'], array_values(array_filter($this->kinds($head), static fn (string $k): bool => $k !== 'map.ops/gm')));
        $ops = $this->publicOps($w, 'bob', $head)[0];
        self::assertTrue($ops['reload'], 'new palette entry: reload the snapshot');
        self::assertSame([[$w['bigFloor'], 4, 4]], $ops['chunks']);
    }

    public function testPausedWritesMapOpsOnly(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'object.add', 'object' => self::wallObject('w-near', $w['bigFloor'], [[3, 8], [4, 8]])]]);
        self::assertSame(['map.ops/gm'], $this->kinds($head));
    }

    public function testConflictingOpsAreNotBroadcast(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $result = $this->opsOk($w['gm'], $w['big'], [
            ['type' => 'object.update', 'uid' => 'gone-uid', 'rev' => 1, 'patch' => ['locked' => true]],
            ['type' => 'object.add', 'object' => self::wallObject('w-new', $w['bigFloor'], [[3, 8], [4, 8]])],
        ]);
        self::assertCount(1, $result['conflicts']);
        $ops = $this->events($head, 'map:' . $w['big'])[0]['payload']['ops'];
        self::assertSame(['object.add'], array_column($ops, 'type'));
    }
}
