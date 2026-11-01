<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9;

/**
 * stairs / portal / door.link, map_links and GET /maps/{id}/links (P9a1).
 */
final class StairsLinksTest extends MapsP9TestCase
{
    public function testStairsAndPortalValidation(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $this->opsOk($gm, $m, [self::floorAdd('up', 'Étage', 1)]);
        $link = ['map_id' => $s['b']['id'], 'floor' => 'f1', 'x' => 3.12345, 'y' => 4];
        $ok = $this->opsOk($gm, $m, [
            self::addObject(self::stairs('s1', 'f1', 'up')),
            self::addObject(self::stairs('s2', 'up', 'f1', ['geometry' => ['x' => 0, 'y' => 0, 'w' => 10, 'h' => 10]], ['direction' => 'down', 'link' => $link])),
            self::addObject(self::portal('p1', 'f1', $link, [], ['label' => 'Vers le village', 'icon' => 'ladder'])),
        ]);
        self::assertSame(3, $ok['applied']);
        $objects = array_column(self::data($this->ok($gm->get('/maps/' . $m . '/objects?floor=f1')))['objects'], null, 'uid');
        self::assertSame('props', $objects['s1']['layer']);
        self::assertSame(['direction' => 'up', 'to_floor' => 'up'], $objects['s1']['props'], 'no link: key absent');
        self::assertSame(['map_id' => (string) $s['b']['id'], 'floor' => 'f1', 'x' => 3.123, 'y' => 4], $objects['p1']['props']['link'], 'map_id is an id: a string in answers');
        self::assertSame(['icon', 'color', 'label', 'link'], array_keys($objects['p1']['props']));

        $st = fn (array $o): array => self::addObject($o);
        $cases = [
            [$st(self::stairs('x', 'f1', 'f1')), ['ops.0.object.props.to_floor' => 'invalid']],
            [$st(self::stairs('x', 'f1', 'nope')), ['ops.0.object.props.to_floor' => 'invalid']],
            [$st(self::stairs('x', 'f1', '12')), ['ops.0.object.props.to_floor' => 'invalid']],
            [$st(self::stairs('x', 'f1', 'up', [], ['direction' => 'left'])), ['ops.0.object.props.direction' => 'invalid']],
            [$st(self::stairs('x', 'f1', 'up', ['geometry' => ['x' => 1, 'y' => 1, 'w' => 11, 'h' => 1]])), ['ops.0.object.geometry.w' => 'too_large']],
            [$st(self::stairs('x', 'f1', 'up', ['geometry' => ['x' => 1.5, 'y' => 1, 'w' => 1, 'h' => 1]])), ['ops.0.object.geometry.x' => 'invalid']],
            [$st(self::stairs('x', 'f1', 'up', ['geometry' => ['x' => 59, 'y' => 1, 'w' => 2, 'h' => 1]])), ['ops.0.object.geometry' => 'out_of_bounds']],
            [$st(self::portal('x', 'f1', ['map_id' => 999999])), ['ops.0.object.props.link.map_id' => 'not_found']],
            [$st(self::portal('x', 'f1', ['map_id' => $s['b']['id'], 'floor' => 'zz'])), ['ops.0.object.props.link.floor' => 'not_found']],
            [$st(self::portal('x', 'f1', ['map_id' => $s['b']['id'], 'extra' => 1])), ['ops.0.object.props.link' => 'invalid']],
            [$st(self::portal('x', 'f1', ['map_id' => null])), ['ops.0.object.props.link.map_id' => 'invalid']],
            [$st(self::portal('x', 'f1', ['map_id' => $s['b']['id']], [], ['color' => 'red'])), ['ops.0.object.props.color' => 'invalid']],
            [$st(self::portal('x', 'f1', ['map_id' => $s['b']['id']], [], ['icon' => 'door2'])), ['ops.0.object.props.icon' => 'invalid']],
            [$st(self::portal('x', 'f1', ['map_id' => $s['b']['id']], [], ['label' => str_repeat('a', 61)])), ['ops.0.object.props.label' => 'invalid']],
            [$st(array_replace(self::portal('x', 'f1', ['map_id' => $s['b']['id']]), ['props' => ['icon' => 'door', 'color' => '#ffffff']])), ['ops.0.object.props.link' => 'required']],
            [self::updateObject('s1', 1, ['props' => ['direction' => 'up', 'to_floor' => 'f1']]), ['ops.0.patch.props.to_floor' => 'invalid']],
        ];
        foreach ($cases as $i => [$op, $errors]) {
            $r = $this->sendOps($gm, $m, [$op]);
            self::assertSame(422, $r->status(), 'case ' . $i . ' ' . $r->body());
            self::assertFieldErrors($r, $errors);
        }
    }

    public function testLinkTargetMustBeALiveMapOfTheSameGame(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $otherGame = (string) $this->newGame($gm)['id'];
        $foreign = $this->newMap($gm, $otherGame, ['name' => 'Ailleurs']);
        $this->opsFail($gm, $m, [self::addObject(self::portal('p', 'f1', ['map_id' => $foreign['id']]))], ['ops.0.object.props.link.map_id' => 'not_found']);
        $this->ok($gm->delete('/maps/' . $s['b']['id']), 204);
        $this->opsFail($gm, $m, [self::addObject(self::portal('p', 'f1', ['map_id' => $s['b']['id']]))], ['ops.0.object.props.link.map_id' => 'not_found']);
    }

    public function testDoorLinkAndMapLinksTableStayInStep(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $door = self::doorObject('d1', 'f1', [5, 2], [6, 2]);
        $door['props']['link'] = ['map_id' => $s['b']['id'], 'floor' => null, 'x' => 2, 'y' => 2];
        $this->opsOk($gm, $m, [self::addObject($door)]);
        $rows = fn () => $this->db->fetchAll('SELECT l.*, o.`uid` FROM ' . $this->db->t('map_links') . ' l JOIN ' . $this->db->t('map_objects') . ' o ON o.`id` = l.`from_object_id` WHERE l.`from_map_id` = ?', [(int) $m]);
        $r = $rows();
        self::assertCount(1, $r);
        self::assertSame([(int) $s['b']['id'], null, 'd1'], [(int) $r[0]['to_map_id'], $r[0]['to_floor_id'], $r[0]['uid']]);
        self::assertSame(2.0, (float) $r[0]['to_x']);

        // Update: link changed to a floor of B, then removed from the props, then re-added, then object removed.
        $this->opsOk($gm, $s['b']['id'] . '', [self::floorAdd('cave', 'Cave', -1)]);
        $door['props']['link'] = ['map_id' => $s['b']['id'], 'floor' => 'cave', 'x' => 5, 'y' => 6];
        $this->opsOk($gm, $m, [self::updateObject('d1', 1, ['props' => $door['props']])]);
        $r = $rows();
        self::assertSame($this->floorId((string) $s['b']['id'], 'cave'), (string) $r[0]['to_floor_id']);
        unset($door['props']['link']);
        $this->opsOk($gm, $m, [self::updateObject('d1', 2, ['props' => $door['props']])]);
        self::assertCount(0, $rows());
        $door['props']['link'] = ['map_id' => $s['b']['id']];
        $this->opsOk($gm, $m, [self::updateObject('d1', 3, ['props' => $door['props']])]);
        self::assertCount(1, $rows());
        $this->opsOk($gm, $m, [['type' => 'object.remove', 'uid' => 'd1']]);
        self::assertCount(0, $rows());
        // A geometry-only update of a linked object keeps its row.
        $this->opsOk($gm, $m, [self::addObject(self::portal('p', 'f1', ['map_id' => $s['b']['id']]))]);
        $this->opsOk($gm, $m, [self::updateObject('p', 1, ['geometry' => ['x' => 9, 'y' => 9]])]);
        self::assertCount(1, $rows());
        // Removing the target floor nulls the floor of the row.
        $this->opsOk($gm, $m, [self::updateObject('p', 2, ['props' => self::portal('p', 'f1', ['map_id' => $s['b']['id'], 'floor' => 'cave'])['props']])]);
        $this->opsOk($gm, (string) $s['b']['id'], [['type' => 'floor.remove', 'uid' => 'cave']]);
        self::assertNull($rows()[0]['to_floor_id']);
    }

    public function testLinksEndpointAndBrokenFlag(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $this->opsOk($gm, (string) $s['b']['id'], [self::floorAdd('cave', 'Cave', -1)]);
        $this->opsOk($gm, $m, [self::addObject(self::portal('p', 'f1', ['map_id' => $s['b']['id'], 'floor' => 'cave', 'x' => 3, 'y' => 4]))]);
        $links = self::data($this->ok($gm->get('/maps/' . $m . '/links')));
        self::assertSame([
            'object_uid' => 'p', 'floor' => 'f1',
            'to' => ['map_id' => (string) $s['b']['id'], 'map_name' => 'Village', 'floor' => 'cave', 'floor_name' => 'Cave', 'x' => 3, 'y' => 4],
            'broken' => false,
        ], $links['outgoing'][0]);
        self::assertSame([], $links['incoming']);
        $in = self::data($this->ok($gm->get('/maps/' . $s['b']['id'] . '/links')));
        self::assertSame([['map_id' => $m, 'map_name' => 'Donjon', 'object_uid' => 'p']], $in['incoming']);

        // Trash: link kept, flagged broken everywhere; restored: valid again; purged: row gone, props kept.
        $this->ok($gm->delete('/maps/' . $s['b']['id']), 204);
        self::assertTrue(self::data($this->ok($gm->get('/maps/' . $m . '/links')))['outgoing'][0]['broken']);
        $objects = self::data($this->ok($gm->get('/maps/' . $m)))['objects'];
        self::assertTrue($objects[0]['props']['link']['broken']);
        self::assertTrue(self::data($this->ok($gm->get('/maps/' . $m . '/objects?floor=f1')))['objects'][0]['props']['link']['broken']);
        self::assertSame([], self::data($this->ok($gm->get('/maps/' . $m . '/links')))['incoming']);
        $this->ok($gm->post('/maps/' . $s['b']['id'] . '/restore'));
        self::assertFalse(self::data($this->ok($gm->get('/maps/' . $m . '/links')))['outgoing'][0]['broken']);
        self::assertArrayNotHasKey('broken', self::data($this->ok($gm->get('/maps/' . $m)))['objects'][0]['props']['link']);
        $this->db->execute('DELETE FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $s['b']['id']]);
        self::assertSame([], self::data($this->ok($gm->get('/maps/' . $m . '/links')))['outgoing']);
        self::assertSame((string) $s['b']['id'], self::data($this->ok($gm->get('/maps/' . $m)))['objects'][0]['props']['link']['map_id']);
    }

    public function testLinksRights(): void
    {
        $s = $this->twoMaps();
        $this->addMember($s['gm'], $s['game'], 'Carl', 'co_gm');
        $this->addMember($s['gm'], $s['game'], 'Bob', 'player');
        $this->createUser('Eve');
        $path = '/maps/' . $s['a']['id'] . '/links';
        self::assertSame(200, $this->login('Carl')->get($path)->status());
        self::assertSame(403, $this->login('Bob')->get($path)->status());
        self::assertSame(404, $this->login('Eve')->get($path)->status());
        self::assertSame(401, $this->client('198.51.100.9')->get($path)->status());
    }
}
