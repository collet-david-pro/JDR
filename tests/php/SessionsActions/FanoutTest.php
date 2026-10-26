<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * D4 (audiences: gm + players, or one user event per player under fog_strict /
 * players_see_other_pcs), D5 (pause: gm only), D3 (merge of maptoken.moved / camera.moved),
 * fog_strict scope changes (what enters / leaves the scope of a player).
 */
final class FanoutTest extends ActionsTestCase
{
    /**
     * bigScene with Dan's dwarf moved far away (block 3:3): Bob's scope = block 0:0, Dan's = 3:3.
     *
     * @return array<string, mixed>
     */
    private function apart(): array
    {
        $w = $this->bigScene();
        $this->actOk($w['gm'], $w['session'], [self::move('t-dwarf', 100, 100)]);

        return $w;
    }

    /**
     * @return list<array{type: string, payload: array<string, mixed>}>
     */
    private function seen(array $w, string $who, int $since): array
    {
        return array_map(
            static fn (array $e): array => ['type' => $e['type'], 'payload' => $e['payload']],
            $this->received($w[$who], $w['channel'], $since),
        );
    }

    public function testFogStrictSendsOnlyToThePlayersConcerned(): void
    {
        $w = $this->apart();
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 9, 6)]);
        self::assertSame(['maptoken.moved/gm', 'maptoken.moved/user'], $this->kinds($head));
        self::assertSame((string) $this->userId('Bob'), (string) $this->events($head)[1]['audience_user_id']);
        self::assertSame(['maptoken.moved'], array_column($this->seen($w, 'bob', $head), 'type'));
        self::assertSame([], $this->seen($w, 'dan', $head));

        // Leaving Bob's scope: he is told the token is gone (not where it went).
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 90, 90)]);
        self::assertEquals([['type' => 'maptoken.removed', 'payload' => ['uid' => 't-goblin', 'view' => 'player']]], $this->seen($w, 'bob', $head));
        $dan = $this->seen($w, 'dan', $head);
        self::assertSame('maptoken.added', $dan[0]['type'], 'entering Dan\'s scope: the whole (filtered) token');
        self::assertSame(90, $dan[0]['payload']['x']);
        // Back near Bob.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 8, 5)]);
        self::assertSame(['maptoken.added'], array_column($this->seen($w, 'bob', $head), 'type'));
        self::assertSame(['maptoken.removed'], array_column($this->seen($w, 'dan', $head), 'type'));
    }

    public function testWithoutFogStrictOneEventForThePlayers(): void
    {
        $w = $this->apart();
        $this->setSettings($w, ['fog_strict' => false]);
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin-far', 160, 160)]);
        self::assertSame(['maptoken.moved/gm', 'maptoken.moved/players'], $this->kinds($head));
        self::assertSame(['maptoken.moved'], array_column($this->seen($w, 'bob', $head), 'type'));
        self::assertSame(['maptoken.moved'], array_column($this->seen($w, 'dan', $head), 'type'));
        // A hidden token: GM only.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-dragon', 7, 7)]);
        self::assertSame(['maptoken.moved/gm'], $this->kinds($head));
    }

    public function testPlayersSeeOtherPcsOff(): void
    {
        $w = $this->bigScene();
        $this->setSettings($w, ['fog_strict' => false, 'players_see_other_pcs' => false]);
        $head = $this->head();
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 6, 6)]);
        self::assertSame(['maptoken.moved/gm', 'maptoken.moved/user'], $this->kinds($head));
        self::assertSame(['maptoken.moved'], array_column($this->seen($w, 'bob', $head), 'type'));
        self::assertSame([], $this->seen($w, 'dan', $head), 'the elf is Bob\'s');
        // A monster is the same for everyone.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 9, 9)]);
        self::assertSame(['maptoken.moved/gm', 'maptoken.moved/players'], $this->kinds($head));
    }

    public function testPauseWritesGmEventsOnly(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [
            self::move('t-goblin', 9, 6),
            ['type' => 'door.toggle', 'uid' => 'door-plain'],
            ['type' => 'reveal', 'kind' => 'token', 'uid' => 't-dragon'],
            ['type' => 'fog.reveal', 'floor' => $w['bigFloor'], 'chunks' => [[0, 0, self::b64(self::fogBits(0, 0, 0, 0, 4, 4))]]],
        ]);
        self::assertSame(['maptoken.moved/gm', 'door.toggled/gm', 'maptoken.updated/gm', 'fog.updated/gm'], $this->kinds($head));
        self::assertSame([], $this->seen($w, 'bob', $head));
        // Resumed: the players reload the snapshot, which has it all.
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/resume'));
        $snap = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/snapshot')));
        self::assertContains('t-dragon', array_column($snap['map']['tokens_placed'], 'uid'));
    }

    public function testMovesAreMergedWithinOneSecond(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 9, 6)]);
        $first = $this->events($head);
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 10, 6)]);
        $this->actOk($w['gm'], $w['session'], [self::move('t-elf', 6, 6)]);
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 11, 6)]);
        $moves = array_values(array_filter($this->events($head), static fn (array $e): bool => $e['payload']['uid'] === 't-goblin'));
        self::assertSame(['gm', 'user', 'user'], array_column($moves, 'audience'), 'one event per key (audience, user, uid)');
        foreach ($moves as $e) {
            self::assertEquals(11, $e['payload']['x']);
            self::assertGreaterThan($first[count($first) - 1]['id'], $e['id'], 'inserted, never edited');
        }
        self::assertCount(1, array_filter($this->events($head), static fn (array $e): bool => $e['payload']['uid'] === 't-elf' && $e['audience'] === 'gm'), 'another token is not merged');
        // A reader that had the first event still gets the last one; a late reader only the last.
        self::assertSame([11], array_column(array_column(array_filter($this->seen($w, 'bob', $first[1]['id']), static fn (array $e): bool => $e['payload']['uid'] === 't-goblin'), 'payload'), 'x'));
        self::assertSame([11], array_column(array_column(array_filter($this->seen($w, 'bob', $head), static fn (array $e): bool => $e['payload']['uid'] === 't-goblin'), 'payload'), 'x'));
    }

    public function testOlderMovesAreKept(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 9, 6)]);
        $this->db->execute('UPDATE ' . $this->db->t('events') . ' SET `created_at` = DATE_SUB(`created_at`, INTERVAL 5 SECOND) WHERE `id` > ?', [$head]);
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 10, 6)]);
        self::assertCount(2, array_filter($this->events($head), static fn (array $e): bool => $e['audience'] === 'gm'));
    }

    public function testCameraMovesAreMerged(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        foreach ([1, 2, 3] as $x) {
            $this->actOk($w['gm'], $w['session'], [['type' => 'camera.set', 'x' => $x, 'y' => 1, 'zoom' => 1]]);
        }
        $events = $this->events($head);
        self::assertCount(1, $events);
        self::assertEquals(3, $events[0]['payload']['x']);
    }

    public function testScopeChangesAreSent(): void
    {
        $w = $this->bigScene();
        $f = $w['bigFloor'];
        $gob = $this->newToken($w['gm'], $w['game'], ['name' => 'Ombre', 'kind' => 'monster']);
        $this->fill($w['gm'], $w['big'], [self::wallObject('wall-east', $f, [[40, 10], [42, 10]])], [self::placedToken('t-east', $f, (string) $gob['id'], 41, 12)]);
        $head = $this->head();
        // Bob walks east: block 1:0 enters his scope (vision 12 + 2 around x = 25).
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 25, 5)]);
        $bob = $this->seen($w, 'bob', $head);
        $ops = array_values(array_filter($bob, static fn (array $e): bool => $e['type'] === 'map.ops.public'));
        self::assertCount(1, $ops);
        self::assertSame(['wall-east'], array_column($ops[0]['payload']['objects']['upsert'], 'uid'));
        self::assertContains([$f, 1, 0], $ops[0]['payload']['chunks']);
        self::assertSame(['t-east'], array_column(array_column(array_filter($bob, static fn (array $e): bool => $e['type'] === 'maptoken.added'), 'payload'), 'uid'));
        self::assertSame([], array_values(array_filter($this->seen($w, 'dan', $head), static fn (array $e): bool => $e['type'] === 'map.ops.public')));
        // And back: they leave it.
        $head = $this->head();
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 5)]);
        $bob = $this->seen($w, 'bob', $head);
        $ops = array_values(array_filter($bob, static fn (array $e): bool => $e['type'] === 'map.ops.public'));
        self::assertSame(['wall-east'], $ops[0]['payload']['objects']['remove']);
        self::assertSame(['t-east'], array_column(array_column(array_filter($bob, static fn (array $e): bool => $e['type'] === 'maptoken.removed'), 'payload'), 'uid'));
    }
}
