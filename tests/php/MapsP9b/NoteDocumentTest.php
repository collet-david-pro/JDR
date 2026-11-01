<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

use JDR\Domain\Sessions\EventTypes;
use JDR\Tests\Api\ApiClient;

/**
 * Notes and revealed objects in the map document: export, import, versions, duplication.
 */
final class NoteDocumentTest extends MapsP9bTestCase
{
    /**
     * Bob and Dan are members; notes gm, players (Bob), all; a pin, a zone, a trap, a passage; the
     * trap revealed.
     *
     * @return array<string, mixed>
     */
    private function content(): array
    {
        $w = $this->bigScene();
        $f = $w['bigFloor'];
        $w['bob_id'] = (string) $this->userId('Bob');
        $w['asset'] = $this->uploadOk($w['gm'], 'valid_webp_lossless.webp', ['kind' => 'tile']);
        $this->opsOk($w['gm'], $w['big'], [
            self::addNote('n-gm', ['read_aloud' => true]),
            self::addNote('n-bob', ['audience' => 'players', 'audience_users' => [$w['bob_id']], 'asset_id' => $w['asset']['id']]),
            self::addNote('n-all', ['audience' => 'all', 'body' => "# Titre\n\n*corps*"]),
            self::add(self::pin('p1', $f, 'n-bob')),
            self::add(self::zone('z1', $f, self::square(20, 20, 4), 'n-gm')),
            self::add(self::trap('t1', $f, 'n-all')),
            self::add(self::passage('s1', $f, [3, 7], [8, 7], 'n-gm')),
        ]);
        $this->actOk($w['gm'], $w['session'], [['type' => 'trap.reveal', 'uid' => 't1']]);

        return $w;
    }

    public function testExportedDocument(): void
    {
        $w = $this->content();
        $doc = $this->exportDoc($w['gm'], $w['big']);

        self::assertSame(1, $doc['format_version']);
        $notes = array_column($doc['notes'], null, 'uid');
        self::assertSame(['uid', 'title', 'body', 'asset', 'audience', 'read_aloud'], array_keys($notes['n-bob']));
        self::assertSame('players', $notes['n-bob']['audience']);
        self::assertMatchesRegularExpression('/^sha256:[0-9a-f]{64}$/', $notes['n-bob']['asset']);
        self::assertTrue($notes['n-gm']['read_aloud']);
        self::assertNull($notes['n-gm']['asset']);
        self::assertSame("# Titre\n\n*corps*", $notes['n-all']['body']);

        $objects = array_column($doc['objects'], null, 'uid');
        self::assertSame('n-bob', $objects['p1']['props']['note']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $objects['t1']['revealed_at']);
        self::assertArrayNotHasKey('revealed_at', $objects['s1']);
        self::assertArrayNotHasKey('note_id', $objects['p1']);
    }

    public function testImportDropsTheAccounts(): void
    {
        $w = $this->content();
        $doc = $this->exportDoc($w['gm'], $w['big']);
        // A reference without note becomes null.
        $doc['objects'][] = ['uid' => 'orphan', 'floor' => 'f1', 'type' => 'pin', 'geometry' => ['x' => 1, 'y' => 1],
            'props' => ['icon' => 'info', 'color' => '#00ff00', 'note' => 'gone']];
        $doc['name'] = 'Importée';

        $data = self::data($this->ok($this->importDoc($w['gm'], $w['game'], $doc), 201));
        $map = (string) $data['map']['id'];
        $notes = array_column($data['map']['notes'], null, 'uid');

        self::assertSame('gm', $notes['n-bob']['audience'], 'accounts do not travel');
        self::assertSame([], $notes['n-bob']['audience_users']);
        self::assertSame(1, (int) $this->noteRow($map, 'n-bob')['gm_only']);
        self::assertSame('all', $notes['n-all']['audience']);
        self::assertSame('gm', $notes['n-gm']['audience']);
        self::assertTrue($notes['n-gm']['read_aloud']);
        self::assertSame($w['asset']['id'], $notes['n-bob']['asset_id'], 'same content among the assets of the importer');

        $objects = array_column($data['map']['objects'], null, 'uid');
        self::assertSame('n-bob', $objects['p1']['props']['note']);
        self::assertSame((int) $this->noteRow($map, 'n-bob')['id'], (int) $this->objectRow($map, 'p1')['note_id']);
        self::assertNull($objects['orphan']['props']['note']);
        self::assertNull($this->objectRow($map, 'orphan')['note_id']);
        self::assertNotNull($this->objectRow($map, 't1')['revealed_at'], 'revealed_at kept');
        self::assertNull($this->objectRow($map, 's1')['revealed_at']);
    }

    public function testImportCannotClaimAnAssetOrAnAccountById(): void
    {
        $w = $this->content();
        $eve = $w['eve'];
        $game = (string) $this->newGame($eve)['id'];
        $doc = $this->exportDoc($w['gm'], $w['big']);

        // Another user: the hash is not one of his assets; the reference is listed as missing.
        $data = self::data($this->ok($this->importDoc($eve, $game, $doc), 201));
        $notes = array_column($data['map']['notes'], null, 'uid');
        self::assertNull($notes['n-bob']['asset_id']);
        self::assertContains($doc['notes'][1]['asset'], array_column($data['missing_assets'], 'ref'));

        // Internal members are refused in a document that comes from outside.
        foreach ([['asset_id' => $w['asset']['id']], ['audience_users' => [$w['bob_id']]]] as $extra) {
            $forged = $doc;
            $forged['notes'][0] += $extra;
            $response = $this->importDoc($eve, $game, $forged);
            self::assertFieldErrors($response, ['notes.0' => 'invalid']);
        }
    }

    public function testInvalidDocuments(): void
    {
        $w = $this->content();
        $doc = $this->exportDoc($w['gm'], $w['big']);
        $cases = [
            [static function (array &$d): void {
                $d['notes'][1]['uid'] = $d['notes'][0]['uid'];
            }, 'notes.1.uid', 'duplicate'],
            [static function (array &$d): void {
                $d['notes'][0]['title'] = '';
            }, 'notes.0.title', 'required'],
            [static function (array &$d): void {
                $d['notes'][0]['asset'] = 'https://evil.example/x.png';
            }, 'notes.0.asset', 'invalid'],
            [static function (array &$d): void {
                $d['notes'] = ['x' => 1];
            }, 'notes', 'invalid'],
            [static function (array &$d): void {
                $d['notes'] = array_fill(0, 501, ['uid' => 'x']);
            }, 'notes', 'too_many'],
            [static function (array &$d): void {
                $d['objects'][0]['revealed_at'] = 'hier';
            }, 'objects.0.revealed_at', 'invalid'],
            [static function (array &$d): void {
                foreach ($d['objects'] as $i => $o) {
                    if ($o['uid'] === 'z1') {
                        $d['objects'][$i]['layer'] = 'props';
                    }
                }
            }, null, 'invalid'],
        ];
        foreach ($cases as [$change, $field, $code]) {
            $broken = $doc;
            $change($broken);
            $response = $this->importDoc($w['gm'], $w['game'], $broken);
            self::assertSame(422, $response->status(), $response->body());
            if ($field !== null) {
                self::assertFieldErrors($response, [$field => $code]);
            }
        }
    }

    public function testVersionKeepsEverythingAndARestoreReloadsWithoutLeak(): void
    {
        $w = $this->content();
        $gm = $w['gm'];
        $map = $w['big'];
        $version = self::data($this->ok($gm->post('/maps/' . $map . '/versions', ['label' => 'avant']), 201));

        // Everything changes after the version.
        $this->opsOk($gm, $map, [
            ['type' => 'note.remove', 'uid' => 'n-bob'],
            ['type' => 'note.update', 'uid' => 'n-all', 'patch' => ['audience' => 'gm']],
            self::addNote('n-new', ['audience' => 'all', 'title' => 'Apparue après']),
            ['type' => 'secrets.reset'],
        ]);
        self::assertSame(['n-new'], array_column($this->snap($w['bob'], $w['session'])['map']['notes'], 'uid'));

        $head = $this->head();
        $restored = self::data($this->ok($gm->post('/maps/' . $map . '/versions/' . $version['id'] . '/restore')));
        $notes = array_column($restored['map']['notes'], null, 'uid');
        self::assertSame(['n-gm', 'n-bob', 'n-all'], array_keys($notes));
        self::assertSame([$w['bob_id']], $notes['n-bob']['audience_users']);
        self::assertSame('players', $notes['n-bob']['audience']);
        self::assertSame($w['asset']['id'], $notes['n-bob']['asset_id']);
        self::assertSame('all', $notes['n-all']['audience']);
        $objects = array_column($restored['map']['objects'], null, 'uid');
        self::assertSame('n-bob', $objects['p1']['props']['note']);
        self::assertSame((int) $this->noteRow($map, 'n-bob')['id'], (int) $this->objectRow($map, 'p1')['note_id']);
        self::assertNotNull($this->objectRow($map, 't1')['revealed_at'], 'revealed_at complete');
        self::assertNull($this->objectRow($map, 's1')['revealed_at']);

        // The session is told to reload; nothing of the notes in the event.
        foreach ([$w['bob'], $w['dan']] as $player) {
            $ops = self::only($this->received($player, $w['channel'], $head), [EventTypes::MAP_OPS_PUBLIC]);
            self::assertCount(1, $ops);
            self::assertTrue($ops[0][1]['reload']);
            self::assertStringNotContainsString('Corps', json_encode($ops, JSON_THROW_ON_ERROR));
        }
        // And the reload is filtered.
        $bob = $this->snap($w['bob'], $w['session'])['map'];
        self::assertEqualsCanonicalizing(['n-bob', 'n-all'], array_column($bob['notes'], 'uid'));
        $dan = $this->snap($w['dan'], $w['session'])['map'];
        self::assertSame(['n-all'], array_column($dan['notes'], 'uid'));
        self::assertNotContains('p1', array_column($dan['objects'], 'uid'));
        self::assertNotContains('z1', array_column($dan['objects'], 'uid'));
        self::assertSame('wall', array_column($dan['objects'], null, 'uid')['s1']['type']);
    }

    public function testARestoreDropsAnAccountThatLeftTheGame(): void
    {
        $w = $this->content();
        $version = self::data($this->ok($w['gm']->post('/maps/' . $w['big'] . '/versions', ['label' => 'avant']), 201));
        $this->ok($w['gm']->delete('/games/' . $w['game'] . '/members/' . $w['bob_id']), 204);

        $restored = self::data($this->ok($w['gm']->post('/maps/' . $w['big'] . '/versions/' . $version['id'] . '/restore')));
        $note = array_column($restored['map']['notes'], null, 'uid')['n-bob'];
        self::assertSame('gm', $note['audience'], 'no account left');
        self::assertSame([], $note['audience_users']);
    }

    public function testDuplicationKeepsNotesAudiencesAndLinks(): void
    {
        $w = $this->content();
        $copy = self::data($this->ok($w['gm']->post('/maps/' . $w['big'] . '/duplicate', []), 201));
        $id = (string) $copy['id'];
        $notes = array_column($copy['notes'], null, 'uid');

        self::assertSame(['n-gm', 'n-bob', 'n-all'], array_keys($notes));
        self::assertSame('players', $notes['n-bob']['audience']);
        self::assertSame([$w['bob_id']], $notes['n-bob']['audience_users']);
        self::assertSame($w['asset']['id'], $notes['n-bob']['asset_id']);
        self::assertSame((int) $this->noteRow($id, 'n-bob')['id'], (int) $this->objectRow($id, 'p1')['note_id']);
        self::assertNotSame($this->noteRow($id, 'n-bob')['id'], $this->noteRow($w['big'], 'n-bob')['id']);
        self::assertNotNull($this->objectRow($id, 't1')['revealed_at']);

        // The two maps are independent.
        $this->opsOk($w['gm'], $id, [['type' => 'note.remove', 'uid' => 'n-gm']]);
        self::assertArrayHasKey('n-gm', $this->notesOf($w['gm'], $w['big']));
    }

    public function testGmSnapshotAndDetailGiveTheFullNotes(): void
    {
        $w = $this->content();
        foreach ([$w['gm'], $w['co']] as $editor) {
            /** @var ApiClient $editor */
            $notes = array_column($this->snap($editor, $w['session'])['map']['notes'], null, 'uid');
            self::assertSame(['uid', 'title', 'body', 'asset_id', 'audience', 'audience_users', 'read_aloud', 'updated_at'], array_keys($notes['n-bob']));
            self::assertCount(3, $notes);
            self::assertCount(3, $this->notesOf($editor, $w['big']));
        }
    }
}
