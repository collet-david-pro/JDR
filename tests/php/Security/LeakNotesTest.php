<?php

declare(strict_types=1);

namespace JDR\Tests\Security;

use JDR\Domain\Sessions\EventFanout;
use JDR\Domain\Sessions\EventTypes;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\MapsP9b\MapsP9bTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Anti-leak test of the notes, pins, zones, traps and secrets (etapes P09, critère 2), played
 * through the API with fog_strict on and off. For a player who is a recipient of a note (Bob), one
 * who is not (Dan) and a screen, every channel is read: snapshot, the event log from the start,
 * preload, chunks, fog, the routes of a map (refused), and searched for unique markers put in the
 * titles, bodies and uids of the notes, the asset ids and the polygons of the zones.
 * Sharing a note then hiding it again: the history already received stays, but reading the log
 * after the withdrawal gives nothing new about it, and the snapshot and preload forget it.
 * The three event types of this phase are provoked here (LeakTest leaves them to this test).
 */
final class LeakNotesTest extends MapsP9bTestCase
{
    public const EVENT_TYPES = [EventTypes::NOTE_SHARED, EventTypes::NOTE_HIDDEN, EventTypes::ZONE_ENTERED];

    /**
     * Every note, by audience at the start: markers of the note (uid, title, body).
     */
    private const NOTE_MARKERS = [
        'gm' => ['mk-n-gm', 'MKTITLEGM', 'MKBODYGM'],
        'bob' => ['mk-n-bob', 'MKTITLEBOB', 'MKBODYBOB'],
        'all' => ['mk-n-all', 'MKTITLEALL', 'MKBODYALL'],
        'late' => ['mk-n-late', 'MKTITLELATE', 'MKBODYLATE'],
    ];

    /** Objects nobody but the GM ever sees (unless the test reveals them). */
    private const NEVER = ['mk-pin-gmnote', 'mk-pin-free-gm', 'mk-pin-free-hidden', 'mk-zone', 'mk-trap-hidden', 'mk-room-hidden', 'mk-object-hidden'];

    /** A coordinate used only by the polygon of the zone. */
    private const ZONE_MARKER = '23.625';

    /**
     * @return array<string, array{0: bool}>
     */
    public static function modes(): array
    {
        return ['fog_strict' => [true], 'fog_strict_off' => [false]];
    }

    /**
     * @return array<string, mixed>
     */
    private function play(bool $strict): array
    {
        $w = $this->bigScene(false);
        $this->setSettings($w, ['fog_strict' => $strict, 'players_blocked_by_walls' => false]);
        $w['table'] = $this->screen($w['gm'], $w['session'], '198.18.9.9');
        $this->startSession($w);
        $w['bob_id'] = (string) $this->userId('Bob');
        $w['dan_id'] = (string) $this->userId('Dan');
        $w['assets'] = [
            'gm' => (string) $this->uploadOk($w['gm'], 'valid_webp_lossless.webp', ['kind' => 'tile'])['id'],
            'bob' => (string) $this->uploadOk($w['gm'], 'valid_jpeg_exif_orientation6.jpg', ['kind' => 'tile'])['id'],
            'all' => (string) $this->uploadOk($w['gm'], 'valid_webp_lossy.webp', ['kind' => 'tile'])['id'],
        ];
        $f = $w['bigFloor'];
        $this->opsOk($w['gm'], $w['big'], [
            self::addNote('mk-n-gm', ['title' => 'MKTITLEGM', 'body' => 'MKBODYGM', 'asset_id' => $w['assets']['gm'], 'read_aloud' => true]),
            self::addNote('mk-n-bob', ['title' => 'MKTITLEBOB', 'body' => 'MKBODYBOB', 'asset_id' => $w['assets']['bob'], 'audience' => 'players', 'audience_users' => [$w['bob_id']]]),
            self::addNote('mk-n-all', ['title' => 'MKTITLEALL', 'body' => 'MKBODYALL', 'asset_id' => $w['assets']['all'], 'audience' => 'all']),
            self::addNote('mk-n-late', ['title' => 'MKTITLELATE', 'body' => 'MKBODYLATE']),
            // Pins: the visibility of a pin with a note does not matter.
            self::add(self::pin('mk-pin-gmnote', $f, 'mk-n-gm', ['visibility' => 'all'])),
            self::add(self::pin('mk-pin-bob', $f, 'mk-n-bob')),
            self::add(self::pin('mk-pin-all', $f, 'mk-n-all')),
            self::add(self::pin('mk-pin-late', $f, 'mk-n-late', ['visibility' => 'all'])),
            self::add(self::pin('mk-pin-free-all', $f, null, ['visibility' => 'all'])),
            self::add(self::pin('mk-pin-free-gm', $f, null)),
            self::add(self::pin('mk-pin-free-hidden', $f, null, ['visibility' => 'hidden_until_revealed'])),
            // Zone.
            self::add(self::zone('mk-zone', $f, [['x' => 4, 'y' => 4], ['x' => 23.625, 'y' => 4], ['x' => 23.625, 'y' => 8], ['x' => 4, 'y' => 8]], 'mk-n-gm')),
            // Traps and secrets, each with a note its reader may or may not read.
            self::add(self::trap('mk-trap-hidden', $f, 'mk-n-gm')),
            self::add(self::trap('mk-trap-shown', $f, 'mk-n-gm')),
            self::add(self::trap('mk-trap-bob', $f, 'mk-n-bob', ['geometry' => ['polygon' => self::square(7, 3, 1)]])),
            self::add(self::passage('mk-pass-hidden', $f, [3, 9], [6, 9], 'mk-n-gm')),
            self::add(self::passage('mk-pass-shown', $f, [3, 10], [6, 10], 'mk-n-all')),
            self::add(self::room('mk-room-hidden', $f, 'mk-n-gm')),
            self::add(self::room('mk-room-shown', $f, 'mk-n-gm')),
            self::add(self::room('mk-object-hidden', $f, 'mk-n-gm', 'object')),
            self::add(self::room('mk-object-shown', $f, 'mk-n-bob', 'object')),
        ]);

        return $w;
    }

    /**
     * Everything $who can read now: [where => JSON-able value].
     *
     * @return array<string, mixed>
     */
    private function reads(array $w, string $who, int $since = 0): array
    {
        /** @var ApiClient $client */
        $client = $w[$who];
        $display = $who === 'table';
        $suffix = $display ? '?as=display' : '';
        $base = '/sessions/' . $w['session'];

        return [
            'snapshot' => $this->snap($client, $w['session'], $display),
            'preload' => self::data($this->ok($client->get($base . '/preload' . $suffix))),
            'events' => $display ? $this->receivedByScreen($client, $w['channel'], $since) : $this->received($client, $w['channel'], $since),
            'fog' => self::data($this->ok($client->get('/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'] . ($display ? '&as=display' : '')))),
        ];
    }

    /**
     * @param list<string> $markers
     * @param array<string, mixed> $reads
     */
    private static function assertAbsent(array $reads, array $markers, string $context): void
    {
        foreach ($reads as $where => $value) {
            $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            foreach ($markers as $marker) {
                self::assertFalse(str_contains($json, $marker), $context . ' / ' . $where . ': ' . $marker);
            }
        }
    }

    /**
     * Nothing about who reads a note, nor what is reserved to the GM, in any channel.
     *
     * @param array<string, mixed> $reads
     */
    private static function assertNoInternals(array $reads, string $context): void
    {
        foreach ($reads as $where => $value) {
            $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            foreach (['"audience_users"', '"read_aloud"', '"show_on_enter"', '"note_id"', '"visibility":"gm"', '"layer":"gm"'] as $key) {
                self::assertFalse(str_contains($json, $key), $context . " / " . $where . ": " . $key);
            }
        }
    }

    /**
     * Forbidden markers of the initial state, by reader.
     *
     * @return array<string, list<string>>
     */
    private static function forbidden(array $w): array
    {
        $note = self::NOTE_MARKERS;
        $never = [...self::NEVER, self::ZONE_MARKER, ...$note['gm'], ...$note['late']];
        $notBob = [...$note['bob'], 'mk-pin-bob'];

        return ['bob' => $never, 'dan' => [...$never, ...$notBob], 'table' => [...$never, ...$notBob]];
    }

    /**
     * @param array<string, mixed> $reads
     * @param list<string>         $ids
     */
    private static function assertNoAsset(array $reads, array $ids, string $context): void
    {
        self::assertEmpty(array_intersect($ids, array_map('strval', array_column($reads['preload']['assets'], 'id'))), $context . ' / preload');
        foreach ($ids as $id) {
            foreach (['snapshot', 'events'] as $where) {
                self::assertStringNotContainsString('"asset_id":"' . $id . '"', json_encode($reads[$where], JSON_THROW_ON_ERROR), $context . ' / ' . $where);
            }
        }
    }

    /**
     * All the channels of the three readers, against the forbidden markers.
     *
     * @param array<string, mixed> $w
     */
    private function inspectAll(array $w, string $when): void
    {
        $forbidden = self::forbidden($w);
        foreach (['bob', 'dan', 'table'] as $who) {
            $reads = $this->reads($w, $who);
            $context = $when . ' ' . $who;
            self::assertAbsent($reads, $forbidden[$who], $context);
            self::assertNoInternals($reads, $context);
            self::assertNoAsset($reads, $who === 'bob' ? [$w['assets']['gm']] : [$w['assets']['gm'], $w['assets']['bob']], $context);
            if (!$reads['events']) {
                continue;
            }
            foreach ($reads['events'] as $event) {
                if ($who === 'table') {
                    self::assertNotContains($event['payload']['view'] ?? null, [EventFanout::VIEW_PLAYER, EventFanout::VIEW_GM], $context . ': ' . $event['type']);
                }
            }
        }
        foreach (['bob', 'dan'] as $who) {
            foreach (['/maps/' . $w['big'], '/maps/' . $w['big'] . '/objects', '/maps/' . $w['big'] . '/versions', '/maps/' . $w['big'] . '/export', '/maps/' . $w['big'] . '/export?format=zip'] as $path) {
                self::assertSame(403, $w[$who]->get($path)->status(), $who . ' ' . $path);
            }
            self::assertSame(403, $w[$who]->get('/events?channels=map:' . $w['big'])->status());
        }
        self::assertSame(403, $w['table']->get('/events?as=display&channels=map:' . $w['big'])->status());
    }

    /**
     * @param array<string, mixed> $w
     * @return array<string, array<string, mixed>>
     */
    private function objectsOf(array $w, string $who): array
    {
        return array_column($this->snap($w[$who], $w['session'], $who === 'table')['map']['objects'], null, 'uid');
    }

    #[DataProvider('modes')]
    public function testNothingOfANoteReachesWhoMayNotReadIt(bool $strict): void
    {
        $w = $this->play($strict);
        $this->inspectAll($w, 'start');

        // Who gets which note, in the shape of a recipient.
        $forms = [
            'bob' => ['mk-n-bob', 'mk-n-all'],
            'dan' => ['mk-n-all'],
            'table' => ['mk-n-all'],
        ];
        foreach ($forms as $who => $uids) {
            $notes = $this->snap($w[$who], $w['session'], $who === 'table')['map']['notes'];
            self::assertEqualsCanonicalizing($uids, array_column($notes, 'uid'), $who);
            foreach ($notes as $note) {
                self::assertSame(['uid', 'title', 'body', 'asset_id'], array_keys($note), $who . ': the recipient form');
            }
        }
        $objects = $this->objectsOf($w, 'bob');
        self::assertArrayHasKey('mk-pin-bob', $objects);
        self::assertArrayHasKey('mk-pin-all', $objects);
        self::assertArrayHasKey('mk-pin-free-all', $objects);
        self::assertArrayNotHasKey('mk-pin-late', $objects);
        self::assertArrayNotHasKey('mk-trap-shown', $objects);
        self::assertArrayNotHasKey('mk-room-shown', $objects);
        self::assertArrayNotHasKey('mk-object-shown', $objects);
        foreach (['bob', 'dan', 'table'] as $who) {
            $objects = $this->objectsOf($w, $who);
            foreach (['mk-pass-hidden', 'mk-pass-shown'] as $uid) {
                self::assertSame('wall', $objects[$uid]['type'], $who . ' ' . $uid);
                self::assertSame(array_keys($objects['door-secret']), array_keys($objects[$uid]), 'the same keys as a secret door');
                self::assertSame($objects['door-secret']['props'], $objects[$uid]['props'], 'the same props as a secret door');
            }
        }

        // The zone speaks to the GM only.
        $head = $this->head();
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 5.5)]);
        $this->opsOk($w['gm'], $w['big'], [['type' => 'object.update', 'uid' => 'mk-zone', 'rev' => 1, 'patch' => ['props' => ['kind' => 'description', 'note' => 'mk-n-gm', 'show_on_enter' => true]]]]);
        $this->actOk($w['gm'], $w['session'], [self::move('t-elf', 2, 2)]);
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 5)]);
        self::assertSame(['mk-zone'], array_column(array_column(self::only($this->received($w['gm'], $w['channel'], $head), [EventTypes::ZONE_ENTERED]), 1), 'zone_uid'));
        $this->inspectAll($w, 'zone');

        // Reveals: the objects come, the walls go, notes they may not read stay null.
        $this->actOk($w['gm'], $w['session'], [
            ['type' => 'trap.reveal', 'uid' => 'mk-trap-shown'],
            ['type' => 'trap.reveal', 'uid' => 'mk-trap-bob'],
            ['type' => 'secret.reveal', 'uid' => 'mk-pass-shown'],
            ['type' => 'secret.reveal', 'uid' => 'mk-room-shown'],
            ['type' => 'secret.reveal', 'uid' => 'mk-object-shown'],
        ]);
        $this->inspectAll($w, 'revealed');
        foreach (['bob' => 'mk-n-bob', 'dan' => null, 'table' => null] as $who => $expected) {
            $objects = $this->objectsOf($w, $who);
            self::assertNull($objects['mk-trap-shown']['props']['note'], $who);
            self::assertSame($expected, $objects['mk-trap-bob']['props']['note'], $who);
            self::assertSame($expected, $objects['mk-object-shown']['props']['note'], $who);
            self::assertNull($objects['mk-room-shown']['props']['note'], $who);
            self::assertSame('mk-n-all', $objects['mk-pass-shown']['props']['note'], $who . ': a note he may read');
            self::assertSame('secret', $objects['mk-pass-shown']['type'], $who);
            self::assertSame('wall', $objects['mk-pass-hidden']['type'], $who);
        }

        // A change Dan may not read: nothing reaches him; what is reserved stays so.
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'mk-n-gm', 'patch' => ['body' => 'MKBODYGM encore']]]);
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.update', 'uid' => 'mk-n-bob', 'patch' => ['body' => 'MKBODYBOB encore']]]);
        $this->inspectAll($w, 'updated');

        // Sharing then hiding again.
        $this->assertWithdrawalLeavesNothingNew($w);

        // Reset: the secrets disappear, the walls come back, without anything new.
        $this->opsOk($w['gm'], $w['big'], [['type' => 'secrets.reset']]);
        foreach (['bob', 'dan', 'table'] as $who) {
            $objects = $this->objectsOf($w, $who);
            self::assertArrayNotHasKey('mk-trap-shown', $objects, $who);
            self::assertArrayNotHasKey('mk-room-shown', $objects, $who);
            self::assertSame('wall', $objects['mk-pass-shown']['type'], $who);
        }

        // The removed note goes with its pin; no reader keeps it.
        $this->opsOk($w['gm'], $w['big'], [['type' => 'note.remove', 'uid' => 'mk-n-bob']]);
        self::assertArrayNotHasKey('mk-pin-bob', $this->objectsOf($w, 'bob'));
        self::assertSame(['mk-n-all'], array_column($this->snap($w['bob'], $w['session'])['map']['notes'], 'uid'));
        self::assertNoAsset(['preload' => self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/preload'))), 'snapshot' => [], 'events' => []], [$w['assets']['bob']], 'removed');

        // A version restored in session: nothing filtered comes back.
        $this->assertRestoreDoesNotLeak($w);

        // Every type of this phase was really written, nothing outside the catalogue.
        $written = array_values(array_unique(array_column($this->events(), 'type')));
        self::assertSame([], array_values(array_diff(self::EVENT_TYPES, $written)));
        self::assertSame([], array_values(array_diff($written, EventTypes::ALL)));
    }

    /**
     * The late note is shared with Dan (and his pin appears), then hidden again.
     *
     * @param array<string, mixed> $w
     */
    private function assertWithdrawalLeavesNothingNew(array $w): void
    {
        $late = self::NOTE_MARKERS['late'];
        $share = fn (string $audience, array $users = []): array => $this->actOk($w['gm'], $w['session'], [
            ['type' => 'note.share', 'note_uid' => 'mk-n-late', 'audience' => $audience] + ($users === [] ? [] : ['users' => $users]),
        ]);

        $head = $this->head();
        $share('players', [$w['dan_id']]);
        self::assertContains('mk-n-late', array_column($this->snap($w['dan'], $w['session'])['map']['notes'], 'uid'));
        self::assertArrayHasKey('mk-pin-late', $this->objectsOf($w, 'dan'));
        foreach (['bob', 'table'] as $who) {
            self::assertAbsent($this->reads($w, $who, $head), $late, $who . ' while Dan reads it');
        }

        $share('gm');
        $after = $this->head();
        // The history already received stays (reading from before the withdrawal)...
        self::assertStringContainsString('MKBODYLATE', json_encode($this->received($w['dan'], $w['channel'], $head), JSON_THROW_ON_ERROR));
        // ... but nothing new after it: not in the log, the snapshot nor the preload.
        $reads = $this->reads($w, 'dan', $after);
        self::assertAbsent($reads, [...$late, 'mk-pin-late'], 'dan after the withdrawal');
        self::assertSame([], $reads['events']);
        // The event that withdrew it only names what he already knew.
        $hidden = self::only($this->received($w['dan'], $w['channel'], $head), [EventTypes::NOTE_HIDDEN]);
        self::assertSame([[EventTypes::NOTE_HIDDEN, ['uid' => 'mk-n-late']]], $hidden);
        foreach (['bob', 'table'] as $who) {
            self::assertAbsent($this->reads($w, $who), $late, $who . ' after the withdrawal');
        }
    }

    /**
     * @param array<string, mixed> $w
     */
    private function assertRestoreDoesNotLeak(array $w): void
    {
        $gm = $w['gm'];
        $version = self::data($this->ok($gm->post('/maps/' . $w['big'] . '/versions', ['label' => 'x']), 201));
        $this->opsOk($gm, $w['big'], [self::addNote('mk-n-new', ['title' => 'MKNEW', 'body' => 'MKNEWBODY'])]);
        $head = $this->head();
        $this->ok($gm->post('/maps/' . $w['big'] . '/versions/' . $version['id'] . '/restore'));
        foreach (['bob', 'dan', 'table'] as $who) {
            $reads = $this->reads($w, $who, $head);
            self::assertAbsent($reads, [...self::NEVER, self::ZONE_MARKER, ...self::NOTE_MARKERS['gm'], 'MKNEW'], $who . ' after a restore');
            self::assertNoInternals($reads, $who . ' after a restore');
            $reloads = array_filter($reads['events'], static fn (array $e): bool => $e['type'] === EventTypes::MAP_OPS_PUBLIC && $e['payload']['reload'] === true);
            self::assertNotEmpty($reloads, $who . ' reloads');
        }
    }

    public function testPinsOutsideAScopeStayOutEvenWithAVisibleNote(): void
    {
        $w = $this->play(true);
        // The note is visible to Bob, its pin is far from him: the scope still applies.
        $this->opsOk($w['gm'], $w['big'], [self::add(self::pin('mk-pin-far', $w['bigFloor'], 'mk-n-all', ['geometry' => ['x' => 185, 'y' => 185]]))]);
        self::assertArrayNotHasKey('mk-pin-far', $this->objectsOf($w, 'bob'));
        self::assertAbsent($this->reads($w, 'bob'), ['mk-pin-far'], 'outside the scope');
        self::assertContains('mk-n-all', array_column($this->snap($w['bob'], $w['session'])['map']['notes'], 'uid'), 'the note itself is not tied to the fog');
    }
}
