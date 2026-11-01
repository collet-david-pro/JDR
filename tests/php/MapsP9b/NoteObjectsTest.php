<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

/**
 * Objects pin, zone, trap, secret: geometry, props, imposed layer and visibility, link to the notes.
 */
final class NoteObjectsTest extends MapsP9bTestCase
{
    /**
     * @return array{0: array<string, mixed>, 1: string, 2: string}
     */
    private function notesWorld(): array
    {
        $w = $this->arena();

        return [$w, $w['map'], $w['floor']];
    }

    public function testTheFourTypesWithTheirDefaults(): void
    {
        [$w, $map, $f] = $this->notesWorld();
        $this->opsOk($w['gm'], $map, [
            self::addNote('n1'),
            self::add(self::pin('p1', $f, 'n1')),
            self::add(self::zone('z1', $f, self::square(1, 1, 2), 'n1')),
            self::add(['uid' => 'z2', 'floor' => $f, 'type' => 'zone', 'geometry' => ['polygon' => self::square(4, 4, 1)], 'props' => []]),
            self::add(self::trap('t1', $f)),
            self::add(['uid' => 't2', 'floor' => $f, 'type' => 'trap', 'geometry' => ['polygon' => self::square(6, 6, 1)], 'props' => []]),
            self::add(self::passage('s1', $f, [1, 8], [3, 8])),
            self::add(self::room('s2', $f)),
            self::add(self::room('s3', $f, null, 'object')),
        ]);
        $o = $this->objectsById($w['gm'], $map);

        self::assertSame('props', $o['p1']['layer']);
        self::assertSame('gm', $o['p1']['visibility']);
        self::assertSame(['icon' => 'place', 'color' => '#ff0000', 'note' => 'n1'], $o['p1']['props']);
        self::assertSame(['x' => 6, 'y' => 6], $o['p1']['geometry']);
        self::assertSame('gm', $o['z1']['layer']);
        self::assertSame('gm', $o['z1']['visibility']);
        self::assertSame(['kind' => 'description', 'note' => null, 'show_on_enter' => false], $o['z2']['props']);
        self::assertSame(self::square(4, 4, 1), $o['z2']['geometry']['polygon']);
        self::assertSame('hidden_until_revealed', $o['t1']['visibility']);
        self::assertSame('props', $o['t1']['layer']);
        self::assertSame(['note' => null, 'reveal_effect' => 'pulse'], $o['t2']['props']);
        self::assertSame('walls', $o['s1']['layer']);
        self::assertSame('hidden_until_revealed', $o['s1']['visibility']);
        self::assertSame('props', $o['s2']['layer']);
        self::assertSame('hidden_until_revealed', $o['s3']['visibility']);

        // Bounding boxes (the columns the scope and the box reads use).
        $box = $this->objectRow($map, 's1');
        self::assertEqualsWithDelta([1.0, 8.0, 3.0, 8.0], [(float) $box['bbox_x1'], (float) $box['bbox_y1'], (float) $box['bbox_x2'], (float) $box['bbox_y2']], 0.001);
        $box = $this->objectRow($map, 'z1');
        self::assertEqualsWithDelta([1.0, 1.0, 3.0, 3.0], [(float) $box['bbox_x1'], (float) $box['bbox_y1'], (float) $box['bbox_x2'], (float) $box['bbox_y2']], 0.001);
        $box = $this->objectRow($map, 'p1');
        self::assertEqualsWithDelta([6.0, 6.0, 6.0, 6.0], [(float) $box['bbox_x1'], (float) $box['bbox_y1'], (float) $box['bbox_x2'], (float) $box['bbox_y2']], 0.001);
    }

    public function testGeometryAndProps(): void
    {
        [$w, $map, $f] = $this->notesWorld();
        $gm = $w['gm'];
        $add = fn (array $object, string $field, string $code) => $this->opsFail($gm, $map, [self::add($object)], ['ops.0.object.' . $field => $code]);

        $add(self::pin('x', $f, null, ['geometry' => ['polygon' => self::square(1, 1, 1)]]), 'geometry', 'invalid');
        $add(self::pin('x', $f, null, ['geometry' => ['x' => 1]]), 'geometry.y', 'required');
        $add(self::pin('x', $f, null, ['geometry' => ['x' => 1000, 'y' => 1]]), 'geometry.x', 'too_large');
        $add(self::pin('x', $f, null, ['props' => ['icon' => 'skull', 'color' => '#ff0000']]), 'props.icon', 'invalid');
        $add(self::pin('x', $f, null, ['props' => ['color' => '#ff0000']]), 'props.icon', 'required');
        $add(self::pin('x', $f, null, ['props' => ['icon' => 'npc', 'color' => 'red']]), 'props.color', 'invalid');
        $add(self::pin('x', $f, null, ['props' => ['icon' => 'npc', 'color' => '#ff0000', 'extra' => 1]]), 'props', 'invalid');
        $add(self::zone('x', $f, [['x' => 1, 'y' => 1], ['x' => 2, 'y' => 2]]), 'geometry.polygon', 'too_small');
        $add(self::zone('x', $f, array_fill(0, 201, ['x' => 1, 'y' => 1])), 'geometry.polygon', 'too_many');
        $add(self::zone('x', $f, [[1, 1], [2, 2], [3, 1]]), 'geometry.polygon.0', 'invalid');
        $add(self::zone('x', $f, self::square(1, 1, 1), null, true, ['props' => ['kind' => 'trigger']]), 'props.kind', 'invalid');
        $add(self::zone('x', $f, self::square(1, 1, 1), null, true, ['props' => ['show_on_enter' => 'yes']]), 'props.show_on_enter', 'invalid');
        $add(self::trap('x', $f, null, ['props' => ['reveal_effect' => 'boom']]), 'props.reveal_effect', 'invalid');
        $add(self::trap('x', $f, null, ['geometry' => ['a' => [1, 1], 'b' => [2, 2]]]), 'geometry', 'invalid');
        $add(self::passage('x', $f, [1, 1], [1, 1]), 'geometry', 'too_small');
        $add(self::passage('x', $f, [1, 1], [3, 1], null, ['geometry' => ['polygon' => self::square(1, 1, 1)]]), 'geometry', 'invalid');
        $add(self::room('x', $f, null, 'room', ['geometry' => ['a' => [1, 1], 'b' => [3, 1]]]), 'geometry', 'invalid');
        $add(self::room('x', $f, null, 'room', ['props' => ['note' => null]]), 'props.kind', 'required');
        $add(self::pin('x', $f, 'not a uid'), 'props.note', 'invalid');
    }

    public function testImposedLayerAndVisibility(): void
    {
        [$w, $map, $f] = $this->notesWorld();
        $gm = $w['gm'];
        $refused = [
            [self::pin('x', $f, null, ['layer' => 'gm']), 'layer'],
            [self::zone('x', $f, self::square(1, 1, 1), null, true, ['layer' => 'props']), 'layer'],
            [self::zone('x', $f, self::square(1, 1, 1), null, true, ['visibility' => 'all']), 'visibility'],
            [self::trap('x', $f, null, ['layer' => 'gm']), 'layer'],
            [self::trap('x', $f, null, ['visibility' => 'all']), 'visibility'],
            [self::trap('x', $f, null, ['visibility' => 'gm']), 'visibility'],
            [self::passage('x', $f, [1, 1], [3, 1], null, ['layer' => 'props']), 'layer'],
            [self::passage('x', $f, [1, 1], [3, 1], null, ['visibility' => 'all']), 'visibility'],
            [self::room('x', $f, null, 'room', ['layer' => 'gm']), 'layer'],
            [self::room('x', $f, null, 'object', ['visibility' => 'gm']), 'visibility'],
        ];
        foreach ($refused as [$object, $key]) {
            $this->opsFail($gm, $map, [self::add($object)], ['ops.0.object.' . $key => 'invalid']);
        }

        $this->opsOk($gm, $map, [
            self::add(self::pin('p', $f, null, ['layer' => 'labels', 'visibility' => 'all'])),
            self::add(self::zone('z', $f, self::square(1, 1, 1))),
            self::add(self::trap('t', $f)),
            self::add(self::passage('s', $f, [1, 1], [3, 1])),
        ]);
        $update = fn (string $uid, array $patch, string $field) => $this->opsFail($gm, $map, [['type' => 'object.update', 'uid' => $uid, 'rev' => 1, 'patch' => $patch]], ['ops.0.patch.' . $field => 'invalid']);
        $update('p', ['layer' => 'gm'], 'layer');
        $update('z', ['layer' => 'props'], 'layer');
        $update('z', ['visibility' => 'all'], 'visibility');
        $update('t', ['visibility' => 'all'], 'visibility');
        $update('t', ['layer' => 'gm'], 'layer');
        $update('s', ['visibility' => 'gm'], 'visibility');
        $update('s', ['layer' => 'props'], 'layer');
        $update('s', ['props' => ['kind' => 'room', 'note' => null]], 'geometry');
        $update('s', ['geometry' => ['polygon' => self::square(1, 1, 1)]], 'geometry');
    }

    public function testNoteLinksFollowTheObject(): void
    {
        [$w, $map, $f] = $this->notesWorld();
        $gm = $w['gm'];
        $noteId = fn (string $uid): int => (int) $this->noteRow($map, $uid)['id'];
        $link = fn (string $uid): ?int => ($v = $this->objectRow($map, $uid)['note_id']) === null ? null : (int) $v;

        // A note and the object naming it in one lot, in this order only.
        $this->opsFail($gm, $map, [self::add(self::pin('p', $f, 'n1')), self::addNote('n1')], ['ops.0.object.props.note' => 'not_found']);
        $this->opsOk($gm, $map, [self::addNote('n1'), self::addNote('n2'), self::add(self::pin('p', $f, 'n1'))]);
        self::assertSame($noteId('n1'), $link('p'));

        $props = static fn (?string $note): array => ['icon' => 'place', 'color' => '#ff0000', 'note' => $note];
        $this->opsFail($gm, $map, [['type' => 'object.update', 'uid' => 'p', 'rev' => 1, 'patch' => ['props' => $props('nope')]]], ['ops.0.patch.props.note' => 'not_found']);
        $this->opsOk($gm, $map, [['type' => 'object.update', 'uid' => 'p', 'rev' => 1, 'patch' => ['props' => $props('n2')]]]);
        self::assertSame($noteId('n2'), $link('p'));
        $this->opsOk($gm, $map, [['type' => 'object.update', 'uid' => 'p', 'rev' => 2, 'patch' => ['props' => $props(null)]]]);
        self::assertNull($link('p'));
        $this->opsOk($gm, $map, [['type' => 'object.update', 'uid' => 'p', 'rev' => 3, 'patch' => ['props' => $props('n1')]]]);

        // A note of another map does not count.
        $other = $this->newMap($gm, $w['game'], ['name' => 'Autre']);
        $this->opsOk($gm, (string) $other['id'], [self::addNote('elsewhere')]);
        $this->opsFail($gm, $map, [self::add(self::pin('q', $f, 'elsewhere'))], ['ops.0.object.props.note' => 'not_found']);

        // note_id is never exposed.
        self::assertStringNotContainsString('note_id', json_encode($this->objectsById($gm, $map), JSON_THROW_ON_ERROR));

        // Removing a note: the objects pass to null, rev + 1.
        $rev = $this->objectsById($gm, $map)['p']['rev'];
        $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n1']]);
        $object = $this->objectsById($gm, $map)['p'];
        self::assertNull($object['props']['note']);
        self::assertSame($rev + 1, $object['rev']);
        self::assertNull($link('p'));
    }

    public function testRemoveThenChangeInTheSameLot(): void
    {
        [$w, $map, $f] = $this->notesWorld();
        $gm = $w['gm'];
        $this->opsOk($gm, $map, [self::addNote('n1'), self::add(self::pin('p', $f, 'n1')), self::add(self::pin('q', $f, 'n1'))]);

        // The object changed later in the lot does not bring the reference back.
        $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n1'], ['type' => 'object.update', 'uid' => 'p', 'rev' => 1, 'patch' => ['sort_order' => 4]]]);
        $o = $this->objectsById($gm, $map);
        self::assertNull($o['p']['props']['note']);
        self::assertSame(4, $o['p']['sort_order']);
        self::assertNull($o['q']['props']['note']);

        // Removed then added again in the lot: the objects keep the note.
        $this->opsOk($gm, $map, [self::addNote('n2'), ['type' => 'object.update', 'uid' => 'q', 'rev' => 2, 'patch' => ['props' => ['icon' => 'info', 'color' => '#00ff00', 'note' => 'n2']]]]);
        $this->opsOk($gm, $map, [['type' => 'note.remove', 'uid' => 'n2'], self::addNote('n2')]);
        self::assertSame('n2', $this->objectsById($gm, $map)['q']['props']['note']);
        self::assertSame((int) $this->noteRow($map, 'n2')['id'], (int) $this->objectRow($map, 'q')['note_id']);
    }

    public function testMapShrinkKeepsTheseObjectsConsistent(): void
    {
        [$w, $map, $f] = $this->notesWorld();
        $gm = $w['gm'];
        $this->opsOk($gm, $map, [
            self::add(self::zone('z-in', $f, self::square(1, 1, 2))),
            self::add(self::zone('z-out', $f, self::square(15, 15, 2))),
            self::add(self::pin('p-out', $f, null, ['geometry' => ['x' => 15, 'y' => 15]])),
        ]);
        $this->opsOk($gm, $map, [['type' => 'map.meta', 'grid' => ['width' => 10, 'height' => 10]]]);
        self::assertSame(['z-in'], array_keys($this->objectsById($gm, $map)));
    }
}
