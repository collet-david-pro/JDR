<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

use JDR\Domain\Sessions\EventTypes;
use JDR\Tests\Api\ApiClient;

/**
 * Session side of the notes and secrets: note.share, note.show, secret.reveal, trap.reveal,
 * secrets.reset, changes made by the ops while the session runs. fog_strict off here (every reader
 * sees the block): LeakNotesTest covers it on.
 */
final class NoteSessionTest extends MapsP9bTestCase
{
    private const NOTE_TYPES = [EventTypes::NOTE_SHARED, EventTypes::NOTE_HIDDEN, EventTypes::MAP_OPS_PUBLIC];

    /**
     * Running session, fog_strict off, a screen, note n1 (audience gm) with the pin p1.
     *
     * @return array<string, mixed>
     */
    private function played(): array
    {
        $w = $this->bigScene(false);
        $this->setSettings($w, ['fog_strict' => false]);
        $w['screen'] = $this->screen($w['gm'], $w['session'], '198.18.9.1');
        $this->startSession($w);
        $this->opsOk($w['gm'], $w['big'], [
            self::addNote('n1', ['title' => 'La clé', 'body' => 'Sous la dalle.']),
            self::add(self::pin('p1', $w['bigFloor'], 'n1')),
        ]);
        $w['bob_id'] = (string) $this->userId('Bob');
        $w['dan_id'] = (string) $this->userId('Dan');

        return $w;
    }

    /**
     * @param list<string> $users
     * @return list<array<string, mixed>>
     */
    private function share(array $w, string $audience, array $users = []): array
    {
        $action = ['type' => 'note.share', 'note_uid' => 'n1', 'audience' => $audience] + ($users === [] ? [] : ['users' => $users]);

        return $this->actOk($w['gm'], $w['session'], [$action]);
    }

    /**
     * What each reader got since $head about notes and objects.
     *
     * @return array{bob: list<mixed>, dan: list<mixed>, screen: list<mixed>}
     */
    private function since(array $w, int $head): array
    {
        return [
            'bob' => self::only($this->received($w['bob'], $w['channel'], $head), self::NOTE_TYPES),
            'dan' => self::only($this->received($w['dan'], $w['channel'], $head), self::NOTE_TYPES),
            'screen' => self::only($this->receivedByScreen($w['screen'], $w['channel'], $head), self::NOTE_TYPES),
        ];
    }

    /**
     * @return array{0: string, 1: array<string, mixed>}
     */
    private static function shared(): array
    {
        return [EventTypes::NOTE_SHARED, ['note' => ['uid' => 'n1', 'title' => 'La clé', 'body' => 'Sous la dalle.', 'asset_id' => null]]];
    }

    /**
     * @param array<string, mixed> $w
     * @param list<array<string, mixed>> $upsert
     * @param list<string>               $remove
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function opsPublic(array $w, array $upsert, array $remove): array
    {
        return [EventTypes::MAP_OPS_PUBLIC, [
            'map_id' => $w['big'], 'revision' => $this->revision($w['big']),
            'objects' => ['upsert' => $upsert, 'remove' => $remove], 'chunks' => [], 'reload' => false,
        ]];
    }

    public function testShareFromGmToOneToSeveralToAllAndBack(): void
    {
        $w = $this->played();
        $pin = $this->objectsById($w['gm'], $w['big'])['p1'];
        $seen = array_replace($pin, ['visibility' => 'all']);

        // gm => Bob
        $head = $this->head();
        $result = $this->share($w, 'players', [$w['bob_id']]);
        self::assertSame(['index' => 0, 'ok' => true, 'note_uid' => 'n1', 'audience' => 'players', 'audience_users' => [$w['bob_id']]], $result[0]);
        self::assertEquals([
            'bob' => [self::shared(), $this->opsPublic($w, [$seen], [])],
            'dan' => [],
            'screen' => [],
        ], $this->since($w, $head));
        $rows = array_values(array_filter($this->events($head), static fn (array $e): bool => $e['type'] === EventTypes::NOTE_SHARED));
        self::assertSame(['gm', 'user'], array_column($rows, 'audience'));
        self::assertSame('gm', $rows[0]['payload']['view']);
        self::assertSame('players', $rows[0]['payload']['note']['audience']);
        self::assertSame([$w['bob_id']], $rows[0]['payload']['note']['audience_users']);
        self::assertSame('player', $rows[1]['payload']['view']);
        self::assertSame((int) $w['bob_id'], (int) $rows[1]['audience_user_id']);
        self::assertEqualsCanonicalizing(['uid', 'title', 'body', 'asset_id'], array_keys($rows[1]['payload']['note']));

        // The same audience again: nothing.
        $head = $this->head();
        $this->share($w, 'players', [$w['bob_id']]);
        self::assertSame($head, $this->head());

        // Bob => Bob + Dan: only Dan gains it.
        $head = $this->head();
        $this->share($w, 'players', [$w['dan_id'], $w['bob_id']]);
        self::assertEquals(['bob' => [], 'dan' => [self::shared(), $this->opsPublic($w, [$seen], [])], 'screen' => []], $this->since($w, $head));

        // => all: only the screen gains it.
        $head = $this->head();
        $this->share($w, 'all');
        self::assertEquals(['bob' => [], 'dan' => [], 'screen' => [self::shared(), $this->opsPublic($w, [$seen], [])]], $this->since($w, $head));
        self::assertSame(['n1'], array_column($this->snap($w['screen'], $w['session'], true)['map']['notes'], 'uid'));

        // => Dan: Bob and the screen lose it.
        $head = $this->head();
        $this->share($w, 'players', [$w['dan_id']]);
        $lost = [[EventTypes::NOTE_HIDDEN, ['uid' => 'n1']], $this->opsPublic($w, [], ['p1'])];
        self::assertEquals(['bob' => $lost, 'dan' => [], 'screen' => $lost], $this->since($w, $head));

        // => gm
        $head = $this->head();
        $this->share($w, 'gm');
        self::assertEquals(['bob' => [], 'dan' => $lost, 'screen' => []], $this->since($w, $head));
        self::assertSame([], $this->snap($w['dan'], $w['session'])['map']['notes']);
        self::assertSame('gm', $this->notesOf($w['gm'], $w['big'])['n1']['audience']);
        self::assertSame(1, (int) $this->noteRow($w['big'], 'n1')['gm_only']);
    }

    public function testShareValidation(): void
    {
        $w = $this->played();
        $revision = $this->revision($w['big']);
        $eve = (string) $this->userId('Eve');
        $share = fn (array $a): \JDR\Core\Response => $this->act($w['gm'], $w['session'], [['type' => 'note.share'] + $a]);

        self::assertFieldErrors($share(['note_uid' => 'nope', 'audience' => 'all']), ['actions.0.note_uid' => 'not_found']);
        self::assertFieldErrors($share(['note_uid' => 'n1', 'audience' => 'friends']), ['actions.0.audience' => 'invalid']);
        self::assertFieldErrors($share(['note_uid' => 'n1', 'audience' => 'players']), ['actions.0.users' => 'required']);
        self::assertFieldErrors($share(['note_uid' => 'n1', 'audience' => 'players', 'users' => [$eve]]), ['actions.0.users' => 'not_member']);
        self::assertFieldErrors($share(['audience' => 'all']), ['actions.0.note_uid' => 'required']);
        self::assertSame($revision, $this->revision($w['big']));

        // A refused action rolls the batch back.
        $response = $this->act($w['gm'], $w['session'], [
            ['type' => 'note.share', 'note_uid' => 'n1', 'audience' => 'all'],
            ['type' => 'note.share', 'note_uid' => 'nope', 'audience' => 'all'],
        ]);
        self::assertSame(422, $response->status());
        self::assertSame('gm', $this->notesOf($w['gm'], $w['big'])['n1']['audience']);
        self::assertSame($revision, $this->revision($w['big']), 'no revision, like door.toggle');
    }

    public function testShowANote(): void
    {
        $w = $this->played();
        $long = str_repeat('x', 20000);
        $this->opsOk($w['gm'], $w['big'], [self::addNote('long', ['body' => $long])]);

        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'note.show', 'note_uid' => 'long']]);
        foreach ([$w['bob'], $w['dan']] as $player) {
            self::assertEquals(
                [[EventTypes::NOTE_READ_ALOUD, ['title' => 'Titre long', 'body' => $long]]],
                self::only($this->received($player, $w['channel'], $head), [EventTypes::NOTE_READ_ALOUD]),
            );
            self::assertSame([], self::only($this->received($player, $w['channel'], $head), [EventTypes::NOTE_SHARED]));
        }
        self::assertSame('gm', $this->notesOf($w['gm'], $w['big'])['long']['audience'], 'the audience does not change');
        self::assertSame([], $this->snap($w['bob'], $w['session'])['map']['notes']);

        self::assertFieldErrors($this->act($w['gm'], $w['session'], [['type' => 'note.show', 'note_uid' => 'nope']]), ['actions.0.note_uid' => 'not_found']);
        self::assertFieldErrors($this->act($w['gm'], $w['session'], [['type' => 'note.show', 'note_uid' => 'n1', 'title' => 'x']]), ['actions.0.note_uid' => 'invalid']);
        // The free form keeps its limit, and still works.
        self::assertFieldErrors($this->act($w['gm'], $w['session'], [['type' => 'note.show', 'title' => 'x', 'body' => str_repeat('x', 4001)]]), ['actions.0.body' => 'too_long']);
        $this->actOk($w['gm'], $w['session'], [['type' => 'note.show', 'title' => 'x', 'body' => 'y']]);
    }

    public function testRevealTrapAndSecret(): void
    {
        $w = $this->played();
        $f = $w['bigFloor'];
        $this->opsOk($w['gm'], $w['big'], [
            self::add(self::trap('t1', $f, 'n1')),
            self::add(self::passage('s1', $f, [3, 7], [8, 7], 'n1')),
            self::add(self::room('s2', $f, 'n1')),
        ]);
        $snap = $this->snap($w['bob'], $w['session']);
        $walls = array_column($snap['map']['objects'], null, 'uid');
        self::assertSame('wall', $walls['s1']['type']);
        self::assertArrayNotHasKey('t1', $walls);
        self::assertArrayNotHasKey('s2', $walls);

        // Wrong type or unknown uid: 422.
        foreach ([['secret.reveal', 't1'], ['trap.reveal', 's1'], ['trap.reveal', 'nope'], ['secret.reveal', 'p1']] as [$type, $uid]) {
            self::assertFieldErrors($this->act($w['gm'], $w['session'], [['type' => $type, 'uid' => $uid]]), ['actions.0.uid' => 'not_found']);
        }

        $head = $this->head();
        $result = $this->actOk($w['gm'], $w['session'], [
            ['type' => 'trap.reveal', 'uid' => 't1'],
            ['type' => 'secret.reveal', 'uid' => 's1'],
            ['type' => 'secret.reveal', 'uid' => 's2'],
        ]);
        self::assertSame(['index' => 0, 'ok' => true, 'kind' => 'object', 'uid' => 't1'], $result[0]);
        $events = self::only($this->received($w['bob'], $w['channel'], $head), [EventTypes::OBJECT_REVEALED]);
        self::assertSame(['t1', 's1', 's2'], array_map(static fn (array $e): string => $e[1]['uid'], $events));
        foreach ($events as [, $object]) {
            self::assertNull($object['props']['note'], 'the note is not visible');
        }
        self::assertSame('secret', $events[1][1]['type'], 'no longer a wall');
        self::assertNotNull($this->objectRow($w['big'], 't1')['revealed_at']);

        // Idempotent.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'trap.reveal', 'uid' => 't1'], ['type' => 'reveal', 'kind' => 'object', 'uid' => 's1']]);
        self::assertSame($head, $this->head());

        $snap = array_column($this->snap($w['dan'], $w['session'])['map']['objects'], null, 'uid');
        self::assertSame('secret', $snap['s1']['type']);
        self::assertSame('trap', $snap['t1']['type']);
        self::assertSame('secret', $snap['s2']['type']);

        // Once the note is shared, the props.note of what is revealed reaches its reader only.
        $head = $this->head();
        $this->share($w, 'players', [$w['bob_id']]);
        $bob = array_column($this->snap($w['bob'], $w['session'])['map']['objects'], null, 'uid');
        self::assertSame('n1', $bob['t1']['props']['note']);
        self::assertSame('n1', $bob['s1']['props']['note']);
        $upsert = self::only($this->received($w['bob'], $w['channel'], $head), [EventTypes::MAP_OPS_PUBLIC])[0][1]['objects']['upsert'];
        self::assertEqualsCanonicalizing(['p1', 't1', 's1', 's2'], array_column($upsert, 'uid'));
        $dan = array_column($this->snap($w['dan'], $w['session'])['map']['objects'], null, 'uid');
        self::assertNull($dan['t1']['props']['note']);
        self::assertSame([], self::only($this->received($w['dan'], $w['channel'], $head), [EventTypes::MAP_OPS_PUBLIC]));
    }

    public function testCollisionsAgainstAPassage(): void
    {
        $w = $this->played();
        $this->setSettings($w, ['players_blocked_by_walls' => true]);
        // Across the way of the elf at (5, 5), going down.
        $this->opsOk($w['gm'], $w['big'], [self::add(self::passage('s1', $w['bigFloor'], [2, 7], [8, 7]))]);

        $result = $this->act($w['bob'], $w['session'], [self::move('t-elf', 5, 9)]);
        $out = self::data($this->ok($result))['results'][0];
        self::assertFalse($out['ok']);
        self::assertSame('blocked_by_wall', $out['error']);
        self::assertLessThan(7, $out['position']['y']);

        $this->actOk($w['gm'], $w['session'], [['type' => 'secret.reveal', 'uid' => 's1']]);
        $out = $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 9)])[0];
        self::assertTrue($out['ok']);
        self::assertSame(9, $out['y']);

        // Hidden again: the wall is back.
        $this->opsOk($w['gm'], $w['big'], [['type' => 'secrets.reset']]);
        $out = $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 5)])[0];
        self::assertFalse($out['ok']);
    }

    public function testZoneEntered(): void
    {
        $w = $this->played();
        $f = $w['bigFloor'];
        $free = $this->newToken($w['gm'], $w['game'], ['name' => 'Errant', 'kind' => 'pc']);
        $this->opsOk($w['gm'], $w['big'], [
            self::addNote('zn', ['title' => 'La fosse']),
            self::add(self::zone('z1', $f, self::square(20, 20, 4), 'zn')),
            self::add(self::zone('z-silent', $f, self::square(30, 20, 4), 'zn', false)),
            self::add(self::zone('z-empty', $f, self::square(40, 20, 4))),
            ['type' => 'maptoken.add', 'token' => self::placedToken('t-free', $f, (string) $free['id'], 18, 18)],
        ]);
        $this->setSettings($w, ['players_blocked_by_walls' => false]);
        $entered = fn (int $head): array => self::only($this->received($w['gm'], $w['channel'], $head), [EventTypes::ZONE_ENTERED]);
        $expected = static fn (string $token): array => [[EventTypes::ZONE_ENTERED, ['zone_uid' => 'z1', 'note_uid' => 'zn', 'title' => 'La fosse', 'token_uid' => $token]]];

        // A player moves his token in: once, for the GM only.
        $head = $this->head();
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 21, 21)]);
        self::assertEquals($expected('t-elf'), $entered($head));
        $rows = array_values(array_filter($this->events($head), static fn (array $e): bool => $e['type'] === EventTypes::ZONE_ENTERED));
        self::assertSame('gm', $rows[0]['audience']);
        self::assertSame(1, (int) $rows[0]['ephemeral']);
        foreach ([$w['bob'], $w['dan']] as $player) {
            self::assertSame([], self::only($this->received($player, $w['channel'], $head), [EventTypes::ZONE_ENTERED]));
        }
        self::assertSame([], self::only($this->receivedByScreen($w['screen'], $w['channel'], $head), [EventTypes::ZONE_ENTERED]));

        // Moving inside and leaving: nothing.
        $head = $this->head();
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 22, 22)]);
        self::assertSame([], $entered($head));
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 18, 18)]);
        self::assertSame([], $entered($head));

        // Coming back counts again; the GM moving a player's token counts too.
        $this->actOk($w['gm'], $w['session'], [self::move('t-elf', 21, 21)]);
        self::assertEquals($expected('t-elf'), $entered($head));

        // A pc nobody plays counts, a monster does not.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-free', 21, 22), self::move('t-goblin', 22, 21)]);
        self::assertEquals($expected('t-free'), $entered($head));

        // show_on_enter off, no note: nothing.
        $head = $this->head();
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 31, 21)]);
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 41, 21)]);
        self::assertSame([], $entered($head));
    }

    public function testSecretsReset(): void
    {
        $w = $this->played();
        $f = $w['bigFloor'];
        $this->opsOk($w['gm'], $w['big'], [
            self::add(self::trap('t1', $f)),
            self::add(self::passage('s1', $f, [3, 7], [8, 7])),
            self::add(self::room('s2', $f)),
            self::add(self::trap('t-never', $f)),
        ]);
        $this->actOk($w['gm'], $w['session'], [
            ['type' => 'trap.reveal', 'uid' => 't1'],
            ['type' => 'secret.reveal', 'uid' => 's1'],
            ['type' => 'secret.reveal', 'uid' => 's2'],
            ['type' => 'reveal', 'kind' => 'object', 'uid' => 'hidden-vis'],
        ]);
        $passage = $this->objectRow($w['big'], 's1');
        $revision = $this->revision($w['big']);

        $head = $this->head();
        $out = $this->opsOk($w['gm'], $w['big'], [['type' => 'secrets.reset']]);
        self::assertSame(1, $out['applied']);
        self::assertSame($revision + 1, $out['revision']);
        self::assertNull($this->objectRow($w['big'], 't1')['revealed_at']);
        self::assertNull($this->objectRow($w['big'], 's1')['revealed_at']);
        self::assertNull($this->objectRow($w['big'], 's2')['revealed_at']);
        self::assertNotNull($this->objectRow($w['big'], 'hidden-vis')['revealed_at'], 'other objects stay revealed');
        self::assertSame($passage['rev'], $this->objectRow($w['big'], 's1')['rev']);

        foreach ([$this->received($w['bob'], $w['channel'], $head), $this->receivedByScreen($w['screen'], $w['channel'], $head)] as $events) {
            $ops = self::only($events, [EventTypes::MAP_OPS_PUBLIC]);
            self::assertCount(1, $ops);
            self::assertEqualsCanonicalizing(['t1', 's2'], $ops[0][1]['objects']['remove']);
            self::assertSame(['s1'], array_column($ops[0][1]['objects']['upsert'], 'uid'));
            self::assertSame('wall', $ops[0][1]['objects']['upsert'][0]['type']);
        }
        $snap = $this->snap($w['bob'], $w['session']);
        $objects = array_column($snap['map']['objects'], null, 'uid');
        self::assertSame('wall', $objects['s1']['type']);
        self::assertArrayNotHasKey('t1', $objects);
        self::assertContains('hidden-vis', $snap['revealed']);
        self::assertNotContains('t1', $snap['revealed']);

        // Nothing left to hide: nothing applied.
        $out = $this->opsOk($w['gm'], $w['big'], [['type' => 'secrets.reset']]);
        self::assertSame(0, $out['applied']);
    }

    public function testChangesMadeByTheOpsWhileTheSessionRuns(): void
    {
        $w = $this->played();
        $gm = $w['gm'];
        $map = $w['big'];
        $this->share($w, 'players', [$w['bob_id']]);

        // Contents changed: its readers get them. Nothing for the others.
        $head = $this->head();
        $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['body' => 'Sous la pierre.']]]);
        $updated = [EventTypes::NOTE_SHARED, ['note' => ['uid' => 'n1', 'title' => 'La clé', 'body' => 'Sous la pierre.', 'asset_id' => null]]];
        self::assertEquals(['bob' => [$updated], 'dan' => [], 'screen' => []], $this->since($w, $head));

        // What a reader does not get does not make an event.
        $head = $this->head();
        $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['read_aloud' => true]]]);
        self::assertEquals(['bob' => [], 'dan' => [], 'screen' => []], $this->since($w, $head));

        // The audience changed by an op: same events as note.share.
        $head = $this->head();
        $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['audience' => 'players', 'audience_users' => [$w['dan_id']]]]]);
        $got = $this->since($w, $head);
        self::assertSame([EventTypes::NOTE_HIDDEN, EventTypes::MAP_OPS_PUBLIC], array_column($got['bob'], 0));
        self::assertSame([EventTypes::NOTE_SHARED, EventTypes::MAP_OPS_PUBLIC], array_column($got['dan'], 0));

        // A new note shared with all, and its pin, in one lot.
        $head = $this->head();
        $this->opsOk($gm, $map, [self::addNote('n2', ['audience' => 'all']), self::add(self::pin('p2', $w['bigFloor'], 'n2'))]);
        foreach ($this->since($w, $head) as $who => $events) {
            self::assertSame([EventTypes::NOTE_SHARED, EventTypes::MAP_OPS_PUBLIC], array_column($events, 0), $who);
            self::assertEquals(['uid' => 'n2', 'title' => 'Titre n2', 'body' => 'Corps n2', 'asset_id' => null], $events[0][1]['note']);
            self::assertSame(['p2'], array_column($events[1][1]['objects']['upsert'], 'uid'));
        }

        // Removed: note.hidden and the pin goes (visibility gm once it has no note).
        $head = $this->head();
        $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n2']]);
        foreach ($this->since($w, $head) as $who => $events) {
            self::assertSame(EventTypes::NOTE_HIDDEN, $events[0][0], $who);
            self::assertSame(['uid' => 'n2'], $events[0][1]);
            self::assertSame(['p2'], $events[1][1]['objects']['remove'], $who);
        }

        // Map.ops carries the bodies to the GM only: the map channel is refused to a player.
        self::assertSame(403, $w['bob']->get('/events?channels=map:' . $map)->status());
        self::assertSame(403, $w['screen']->get('/events?as=display&channels=map:' . $map)->status());
    }

    public function testPausedSessionWritesNothingForThePlayers(): void
    {
        $w = $this->played();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $head = $this->head();
        $this->share($w, 'all');
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['title' => 'Autre']]]);
        $rows = array_filter($this->events($head), static fn (array $e): bool => in_array($e['type'], self::NOTE_TYPES, true));
        self::assertSame(['gm'], array_values(array_unique(array_column($rows, 'audience'))));
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/resume'));
        self::assertSame('Autre', $this->snap($w['bob'], $w['session'])['map']['notes'][0]['title'], 'read at the reload');
    }

    public function testPlayersAreRefusedEveryAction(): void
    {
        $w = $this->played();
        foreach ([
            ['type' => 'note.share', 'note_uid' => 'n1', 'audience' => 'all'],
            ['type' => 'note.show', 'note_uid' => 'n1'],
            ['type' => 'secret.reveal', 'uid' => 's1'],
            ['type' => 'trap.reveal', 'uid' => 't1'],
        ] as $action) {
            self::assertSame(403, $this->act($w['bob'], $w['session'], [$action])->status(), $action['type']);
        }
        self::assertSame(403, $this->sendOps($w['bob'], $w['big'], [['type' => 'secrets.reset']])->status());
    }

    public function testKickedOrRemovedPlayersGetNothing(): void
    {
        $w = $this->played();
        $this->share($w, 'players', [$w['bob_id'], $w['dan_id']]);

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/kick', ['user_id' => $w['dan_id']]), 204);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['body' => 'Après le renvoi.']]]);
        self::assertSame(403, $w['dan']->get('/sessions/' . $w['session'] . '/snapshot')->status());
        self::assertSame(403, $w['dan']->get('/events?channels=' . rawurlencode($w['channel']) . '&since=' . $head . '&wait=0')->status());
        $rows = array_filter($this->events($head), static fn (array $e): bool => $e['type'] === EventTypes::NOTE_SHARED);
        self::assertSame([(int) $w['bob_id']], array_values(array_map(static fn (array $e): int => (int) $e['audience_user_id'], $rows)));

        // Removed from the game: kicked from its open sessions.
        $this->ok($w['gm']->delete('/games/' . $w['game'] . '/members/' . $w['bob_id']), 204);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['body' => 'Après le retrait.']]]);
        self::assertSame(403, $w['bob']->get('/sessions/' . $w['session'] . '/snapshot')->status());
        self::assertSame(403, $w['bob']->get('/sessions/' . $w['session'] . '/preload')->status());
        self::assertSame(403, $w['bob']->get('/events?channels=' . rawurlencode($w['channel']) . '&since=' . $head . '&wait=0')->status());
        self::assertSame('kicked', $this->playerStatus($w['session'], 'Bob'));
        self::assertSame([], array_values(array_filter($this->events($head), static fn (array $e): bool => $e['type'] === EventTypes::NOTE_SHARED)));
        self::assertNotContains(EventTypes::NOTE_SHARED, array_column($this->receivedByScreen($w['screen'], $w['channel'], $head), 'type'));
    }

    public function testImageOfANoteFollowsItsVisibility(): void
    {
        $w = $this->played();
        $asset = $this->uploadOk($w['gm'], 'valid_webp_lossless.webp', ['kind' => 'tile']);
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['asset_id' => $asset['id']]]]);
        $preload = fn (ApiClient $c, string $suffix = ''): array => array_column(self::data($this->ok($c->get('/sessions/' . $w['session'] . '/preload' . $suffix)))['assets'], null, 'id');

        self::assertArrayHasKey($asset['id'], $preload($w['gm']));
        self::assertArrayNotHasKey($asset['id'], $preload($w['bob']));
        self::assertArrayNotHasKey($asset['id'], $preload($w['screen'], '?as=display'));

        $this->share($w, 'players', [$w['bob_id']]);
        $seen = $preload($w['bob']);
        self::assertArrayHasKey($asset['id'], $seen);
        self::assertArrayNotHasKey($asset['id'], $preload($w['dan']));
        self::assertSame($asset['id'], $this->snap($w['bob'], $w['session'])['map']['notes'][0]['asset_id']);
        // The signed URL opens the file for him.
        self::assertSame(200, $w['bob']->get(substr((string) $seen[$asset['id']]['url'], strlen('/api/v1')))->status());
        // A change of image reaches the reader.
        $other = $this->uploadOk($w['gm'], 'valid_jpeg_exif_orientation6.jpg', ['kind' => 'tile']);
        $head = $this->head();
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['asset_id' => $other['id']]]]);
        self::assertSame($other['id'], self::only($this->received($w['bob'], $w['channel'], $head), [EventTypes::NOTE_SHARED])[0][1]['note']['asset_id']);
        self::assertArrayNotHasKey($asset['id'], $preload($w['bob']));

        $this->share($w, 'all');
        self::assertArrayHasKey($other['id'], $preload($w['screen'], '?as=display'));
        $this->share($w, 'gm');
        self::assertArrayNotHasKey($other['id'], $preload($w['screen'], '?as=display'));
    }
}
