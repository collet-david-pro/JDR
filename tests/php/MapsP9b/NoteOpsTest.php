<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

/**
 * Ops note.add / note.update / note.remove: validation, lots, revision, idempotence.
 */
final class NoteOpsTest extends MapsP9bTestCase
{
    public function testAddReadUpdateRemove(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $map = $w['map'];
        $bob = (string) $this->userId('Bob');
        $revision = $this->revision($map);
        $markdown = "  # Titre\n\n* **gras** <b>brut</b>  \n";

        $out = $this->opsOk($gm, $map, [self::addNote('n1', ['title' => '  Le puits  ', 'body' => $markdown])]);
        self::assertSame(1, $out['applied']);
        self::assertSame($revision + 1, $out['revision']);

        $note = $this->notesOf($gm, $map)['n1'];
        self::assertSame(['uid', 'title', 'body', 'asset_id', 'audience', 'audience_users', 'read_aloud', 'updated_at'], array_keys($note));
        self::assertSame('Le puits', $note['title'], 'trimmed');
        self::assertSame($markdown, $note['body'], 'the body is stored as it is');
        self::assertSame('gm', $note['audience']);
        self::assertSame([], $note['audience_users']);
        self::assertFalse($note['read_aloud']);
        self::assertNull($note['asset_id']);
        self::assertSame(1, (int) $this->noteRow($map, 'n1')['gm_only']);

        $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['audience' => 'players', 'audience_users' => [$bob], 'read_aloud' => true]]]);
        $note = $this->notesOf($gm, $map)['n1'];
        self::assertSame('players', $note['audience']);
        self::assertSame([$bob], $note['audience_users']);
        self::assertTrue($note['read_aloud']);
        self::assertSame('Le puits', $note['title'], 'untouched');
        self::assertSame(0, (int) $this->noteRow($map, 'n1')['gm_only']);

        // audience_users is ignored unless "players", and the accounts are dropped.
        $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['audience' => 'all', 'audience_users' => ['nonsense']]]]);
        $note = $this->notesOf($gm, $map)['n1'];
        self::assertSame('all', $note['audience']);
        self::assertSame([], $note['audience_users']);
        self::assertSame(0, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('map_note_users')));

        $revision = $this->revision($map);
        $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n1']]);
        self::assertSame($revision + 1, $this->revision($map));
        self::assertSame([], $this->notesOf($gm, $map));

        // Idempotent: nothing applied, the revision stays.
        $out = $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n1']]);
        self::assertSame(0, $out['applied']);
        self::assertSame($revision + 1, $out['revision']);

        // Undo on the client: note.add with the same uid.
        $this->opsOk($gm, $map, [self::addNote('n1')]);
        self::assertArrayHasKey('n1', $this->notesOf($gm, $map));
    }

    public function testValidation(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $map = $w['map'];
        $eve = (string) $this->userId('Eve');
        $long = str_repeat('é', 20001);
        $this->opsOk($gm, $map, [self::addNote('taken')]);

        $cases = [
            [self::addNote('n', ['title' => '   ']), 'ops.0.note.title', 'required'],
            [self::addNote('n', ['title' => str_repeat('a', 121)]), 'ops.0.note.title', 'too_long'],
            [self::addNote('n', ['title' => 12]), 'ops.0.note.title', 'invalid'],
            [self::addNote('n', ['body' => $long]), 'ops.0.note.body', 'too_long'],
            [self::addNote('n', ['body' => 12]), 'ops.0.note.body', 'invalid'],
            [['type' => 'note.add', 'note' => ['uid' => 'n', 'title' => 'x']], 'ops.0.note.body', 'required'],
            [self::addNote('n', ['audience' => 'friends']), 'ops.0.note.audience', 'invalid'],
            [self::addNote('n', ['audience' => 'players']), 'ops.0.note.audience_users', 'required'],
            [self::addNote('n', ['audience' => 'players', 'audience_users' => []]), 'ops.0.note.audience_users', 'required'],
            [self::addNote('n', ['audience' => 'players', 'audience_users' => [$eve]]), 'ops.0.note.audience_users', 'not_member'],
            [self::addNote('n', ['audience' => 'players', 'audience_users' => ['x']]), 'ops.0.note.audience_users', 'invalid'],
            [self::addNote('n', ['read_aloud' => 'yes']), 'ops.0.note.read_aloud', 'invalid'],
            [self::addNote('n', ['asset_id' => '999999']), 'ops.0.note.asset_id', 'not_found'],
            [self::addNote('bad uid'), 'ops.0.note.uid', 'invalid'],
            [self::addNote('taken'), 'ops.0.note.uid', 'taken'],
            [self::addNote('TAKEN'), 'ops.0.note.uid', 'taken'],
            [['type' => 'note.add'], 'ops.0.note', 'required'],
            [['type' => 'note.update', 'uid' => 'taken'], 'ops.0.patch', 'required'],
            [['type' => 'note.update', 'uid' => 'taken', 'patch' => ['nope' => 1]], 'ops.0.patch', 'invalid'],
            [['type' => 'note.update', 'uid' => 'taken', 'patch' => ['title' => '']], 'ops.0.patch.title', 'required'],
            [['type' => 'note.update', 'uid' => 'taken', 'patch' => ['audience' => 'players']], 'ops.0.patch.audience_users', 'required'],
            [['type' => 'note.update', 'uid' => 'taken', 'patch' => ['body' => $long]], 'ops.0.patch.body', 'too_long'],
            [['type' => 'note.remove'], 'ops.0.uid', 'required'],
        ];
        foreach ($cases as [$op, $field, $code]) {
            $this->opsFail($gm, $map, [$op], [$field => $code]);
        }

        // Exactly 20 000 characters are accepted, and the second lot of a failed one is untouched.
        $this->opsOk($gm, $map, [self::addNote('max', ['body' => str_repeat('é', 20000)])]);
        self::assertSame(20000, mb_strlen($this->notesOf($gm, $map)['max']['body']));
        $this->opsFail($gm, $map, [self::addNote('rolled-back'), self::addNote('taken')], ['ops.1.note.uid' => 'taken']);
        self::assertArrayNotHasKey('rolled-back', $this->notesOf($gm, $map));

        // An unknown uid is a conflict, like object.update.
        $out = $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'gone', 'patch' => ['title' => 'x']]]);
        self::assertSame(0, $out['applied']);
        self::assertSame([['op_index' => 0, 'kind' => 'note', 'uid' => 'gone', 'reason' => 'gone', 'current' => null]], $out['conflicts']);
    }

    public function testLimitPerMap(): void
    {
        $w = $this->arena();
        $map = (int) $w['map'];
        for ($i = 0; $i < 500; $i++) {
            $this->db->execute(
                'INSERT INTO ' . $this->db->t('map_notes') . " (`map_id`, `uid`, `title`, `body`, `updated_at`) VALUES (?, ?, 't', '', UTC_TIMESTAMP())",
                [$map, 'seed' . $i],
            );
        }
        $this->opsFail($w['gm'], $w['map'], [self::addNote('one-more')], ['ops.0' => 'limit']);
        $this->opsOk($w['gm'], $w['map'], [['type' => 'note.remove', 'uid' => 'seed0'], self::addNote('one-more')]);
    }

    public function testIdempotenceOfALot(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $map = $w['map'];

        $first = self::data($this->ok($this->sendOps($gm, $map, [self::addNote('n1')], null, 'lot-1')));
        $replay = self::data($this->ok($this->sendOps($gm, $map, [self::addNote('n1')], null, 'lot-1')));
        self::assertSame($first, $replay);
        self::assertCount(1, $this->notesOf($gm, $map));
    }

    public function testRights(): void
    {
        $w = $this->arena();
        $map = $w['map'];
        foreach ([
            self::addNote('n1'),
            ['type' => 'note.update', 'uid' => 'n1', 'patch' => ['title' => 'x']],
            ['type' => 'note.remove', 'uid' => 'n1'],
            ['type' => 'secrets.reset'],
        ] as $op) {
            self::assertSame(403, $this->sendOps($w['bob'], $map, [$op])->status(), $op['type']);
            self::assertSame(404, $this->sendOps($w['eve'], $map, [$op])->status(), $op['type']);
        }
        $this->opsOk($w['co'], $map, [self::addNote('by-co')]);
        self::assertArrayHasKey('by-co', $this->notesOf($w['gm'], $map));
        foreach (['/maps/' . $map, '/maps/' . $map . '/objects', '/maps/' . $map . '/versions', '/maps/' . $map . '/export'] as $path) {
            self::assertSame(403, $w['bob']->get($path)->status(), $path);
        }
    }

    public function testImageOfANote(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $map = $w['map'];
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $other = $this->uploadOk($gm, 'valid_png_transparent.png', ['kind' => 'tile']);
        $refs = fn (string $id): int => (int) $this->db->fetchValue('SELECT COALESCE(SUM(`ref_count`), 0) FROM ' . $this->db->t('map_asset_refs') . ' WHERE `map_id` = ? AND `asset_id` = ?', [(int) $map, (int) $id]);

        $this->opsOk($gm, $map, [self::addNote('n1', ['asset_id' => $asset['id']])]);
        self::assertSame($asset['id'], $this->notesOf($gm, $map)['n1']['asset_id']);
        self::assertSame(1, $refs($asset['id']));

        $this->opsOk($gm, $map, [['type' => 'note.update', 'uid' => 'n1', 'patch' => ['asset_id' => $other['id']]]]);
        self::assertSame(0, $refs($asset['id']));
        self::assertSame(1, $refs($other['id']));

        // Someone else's asset cannot be used.
        $foreign = $this->uploadOk($w['bob'], 'valid_webp_lossy.webp', ['kind' => 'tile']);
        $this->opsFail($gm, $map, [self::addNote('n2', ['asset_id' => $foreign['id']])], ['ops.0.note.asset_id' => 'not_found']);

        $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n1']]);
        self::assertSame(0, $refs($other['id']));
    }
}
