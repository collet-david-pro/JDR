<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9;

/**
 * floor.add / floor.update / floor.remove and floor references by id or uid (P9a1, D1).
 */
final class FloorOpsTest extends MapsP9TestCase
{
    public function testNewMapsAndFloorsExposeUids(): void
    {
        $s = $this->twoMaps();
        self::assertSame('f1', $s['a']['floors'][0]['uid']);
        self::assertSame(['id', 'uid', 'level', 'name', 'sort_order'], array_keys($s['a']['floors'][0]));
        $copy = self::data($this->ok($s['gm']->post('/maps/' . $s['a']['id'] . '/duplicate', ['name' => 'Copie']), 201));
        self::assertSame('f1', $copy['floors'][0]['uid']);
        self::assertNotSame($s['a']['floors'][0]['id'], $copy['floors'][0]['id']);
    }

    public function testEveryOpAcceptsAFloorIdOrAUid(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $token = $this->newToken($gm, $s['game'], ['name' => 'Garde', 'kind' => 'npc']);
        $this->opsOk($gm, $m, [self::paletteAdd(1, $asset['id']), self::floorAdd('up', 'Étage', 1)]);
        $up = $this->floorId($m, 'up');
        foreach ([['up', 'o1', 't1', 3], [$up, 'o2', 't2', 4]] as [$ref, $objUid, $tokUid, $x]) {
            $data = $this->opsOk($gm, $m, [
                self::tiles($ref, 'ground', [[$x, 1, 1]]),
                self::addObject(self::wallObject($objUid, $ref, [[1, $x], [5, $x]])),
                self::addToken(self::placedToken($tokUid, $ref, (string) $token['id'], $x, 2)),
                self::fogReveal($ref),
            ]);
            self::assertSame(4, $data['applied']);
        }
        self::assertSame(2, $this->rows('map_objects', '`map_id` = ? AND `floor_id` = ?', [(int) $m, (int) $up]));
        self::assertSame(2, $this->rows('map_tokens', '`map_id` = ? AND `floor_id` = ?', [(int) $m, (int) $up]));
        $objects = array_column(self::data($this->ok($gm->get('/maps/' . $m . '/objects?floor=up')))['objects'], 'floor', 'uid');
        self::assertSame(['o1' => $up, 'o2' => $up], $objects, 'API form of the floor = id string');
        self::assertSame(self::data($this->ok($gm->get('/maps/' . $m . '/objects?floor=' . $up))), self::data($this->ok($gm->get('/maps/' . $m . '/objects?floor=up'))));
        // Chunks and fog reads.
        $byUid = $this->ok($gm->get('/maps/' . $m . '/chunks?floor=up'))->body();
        $byId = $this->ok($gm->get('/maps/' . $m . '/chunks?floor=' . $up))->body();
        self::assertCount(1, self::parseChunks($byUid));
        self::assertSame($byId, $byUid);
        self::assertSame(self::data($this->ok($gm->get('/maps/' . $m . '/fog?floor=' . $up)))['chunks'], self::data($this->ok($gm->get('/maps/' . $m . '/fog?floor=up')))['chunks']);
        // Unknown references.
        $this->opsFail($gm, $m, [self::tiles('nope', 'ground', [[1, 1, 1]])], ['ops.0.floor' => 'not_found']);
        $this->opsFail($gm, $m, [self::tiles('a/b', 'ground', [[1, 1, 1]])], ['ops.0.floor' => 'invalid']);
        self::assertSame(422, $gm->get('/maps/' . $m . '/chunks?floor=nope')->status());
        // The first floor too.
        $this->opsOk($gm, $m, [self::addObject(self::wallObject('o3', 'f1', [[1, 9], [5, 9]]))]);
    }

    public function testFloorAddUpdateRemoveAndRevision(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $rev = $this->revision($m);
        $data = $this->opsOk($gm, $m, [self::floorAdd('cave', 'Cave', -1), self::floorAdd('up', 'Étage', 2)]);
        self::assertSame(2, $data['applied']);
        self::assertSame($rev + 1, $data['revision']);
        self::assertSame(['cave', 'f1', 'up'], array_column($this->floorsOf($gm, $m), 'uid'), 'floors are ordered by level');
        self::assertSame([0, 1, 2], array_column($this->floorsOf($gm, $m), 'sort_order'));

        $this->opsOk($gm, $m, [['type' => 'floor.update', 'uid' => 'up', 'patch' => ['name' => '  Grenier ', 'level' => -3]]]);
        $floors = $this->floorsOf($gm, $m);
        self::assertSame(['up', 'cave', 'f1'], array_column($floors, 'uid'));
        self::assertSame('Grenier', $floors[0]['name']);
        self::assertSame(-3, $floors[0]['level']);

        $noop = $this->opsOk($gm, $m, [['type' => 'floor.update', 'uid' => 'up', 'patch' => ['name' => 'Grenier']]]);
        self::assertSame(1, $noop['applied']);

        $this->opsOk($gm, $m, [['type' => 'floor.remove', 'uid' => 'cave']]);
        self::assertSame(['up', 'f1'], array_column($this->floorsOf($gm, $m), 'uid'));
    }

    public function testValidation(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $this->opsOk($gm, $m, [self::floorAdd('up', 'Étage', 1)]);
        $add = static fn (array $over): array => ['type' => 'floor.add', 'floor' => $over + ['uid' => 'x1', 'name' => 'N', 'level' => 5]];
        $cases = [
            [$add(['uid' => '123']), ['ops.0.floor.uid' => 'invalid']],
            [$add(['uid' => 'a b']), ['ops.0.floor.uid' => 'invalid']],
            [$add(['uid' => str_repeat('x', 22)]), ['ops.0.floor.uid' => 'invalid']],
            [$add(['name' => '   ']), ['ops.0.floor.name' => 'invalid']],
            [$add(['name' => str_repeat('é', 61)]), ['ops.0.floor.name' => 'invalid']],
            [$add(['level' => 10]), ['ops.0.floor.level' => 'invalid']],
            [$add(['level' => -10]), ['ops.0.floor.level' => 'invalid']],
            [$add(['level' => 1.5]), ['ops.0.floor.level' => 'invalid']],
            [$add(['uid' => 'up']), ['ops.0.floor.uid' => 'taken']],
            [$add(['level' => 0]), ['ops.0.floor.level' => 'taken']],
            [['type' => 'floor.add'], ['ops.0.floor' => 'required']],
            [['type' => 'floor.add', 'floor' => ['uid' => 'x1', 'name' => 'N', 'level' => 3, 'extra' => 1]], ['ops.0.floor' => 'invalid']],
            [['type' => 'floor.update', 'uid' => 'nope', 'patch' => ['name' => 'Z']], ['ops.0.uid' => 'not_found']],
            [['type' => 'floor.update', 'uid' => 'up', 'patch' => []], ['ops.0.patch' => 'invalid']],
            [['type' => 'floor.update', 'uid' => 'up', 'patch' => ['level' => 0]], ['ops.0.patch.level' => 'taken']],
            [['type' => 'floor.update', 'uid' => 'up', 'patch' => ['name' => '']], ['ops.0.patch.name' => 'invalid']],
            [['type' => 'floor.remove', 'uid' => 'nope'], ['ops.0.uid' => 'not_found']],
            [['type' => 'floor.remove'], ['ops.0.uid' => 'required']],
        ];
        foreach ($cases as $i => [$op, $errors]) {
            $response = $this->sendOps($gm, $m, [$op]);
            self::assertSame(422, $response->status(), 'case ' . $i . ': ' . $response->body());
            self::assertFieldErrors($response, $errors);
        }
        // 10 floors at most.
        $ops = [];
        for ($i = 2; $i <= 9; $i++) {
            $ops[] = self::floorAdd('fl' . $i, 'Étage ' . $i, $i);
        }
        $this->opsOk($gm, $m, $ops);
        self::assertCount(10, $this->floorsOf($gm, $m));
        $this->opsFail($gm, $m, [self::floorAdd('one-more', 'Trop', -5)], ['ops.0.floor' => 'limit']);
        // The last floor stays.
        $this->opsOk($gm, $m, array_map(static fn (int $i): array => ['type' => 'floor.remove', 'uid' => 'fl' . $i], range(2, 9)));
        $this->opsOk($gm, $m, [['type' => 'floor.remove', 'uid' => 'up']]);
        $this->opsFail($gm, $m, [['type' => 'floor.remove', 'uid' => 'f1']], ['ops.0.uid' => 'last_floor']);
        // Rights: a player of the game cannot.
        $this->addMember($gm, $s['game'], 'Bob', 'player');
        self::assertSame(403, $this->sendOps($this->login('Bob'), $m, [self::floorAdd('bob', 'B', 4)])->status());
    }

    public function testRemoveDeletesTheWholeFloorAndReleasesAssetRefs(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $token = $this->newToken($gm, $s['game'], ['name' => 'Garde', 'kind' => 'npc']);
        $this->opsOk($gm, $m, [self::paletteAdd(1, $asset['id']), self::floorAdd('up', 'Étage', 1), self::floorAdd('cave', 'Cave', -1)]);
        $this->opsOk($gm, $m, [self::tiles('f1', 'ground', [[1, 1, 1], [2, 1, 1]]), self::tiles('up', 'ground', [[1, 1, 1], [40, 30, 1]]),
            self::tiles('up', 'decor', [[3, 3, 1]]), self::tiles('cave', 'ground', [[9, 9, 1]])]);
        $up = $this->floorId($m, 'up');
        $this->opsOk($gm, $m, [
            self::addObject(self::wallObject('wu', 'up', [[1, 1], [5, 1]])),
            self::addToken(self::placedToken('tu', 'up', (string) $token['id'], 3, 3)),
            self::fogReveal('up'),
            self::addObject(self::wallObject('wf', 'f1', [[1, 4], [5, 4]])),
        ]);
        $refs = $this->storedRefs($m);
        self::assertSame(array_sum($this->recountRefs($m)), array_sum($refs));
        self::assertSame(6, array_sum($refs));
        $rev = $this->revision($m);

        $data = $this->opsOk($gm, $m, [['type' => 'floor.remove', 'uid' => 'up']]);
        self::assertSame($rev + 1, $data['revision']);
        foreach (['map_chunks' => 'floor_id', 'map_objects' => 'floor_id', 'map_tokens' => 'floor_id', 'map_fog' => 'floor_id'] as $table => $col) {
            self::assertSame(0, $this->rows($table, '`' . $col . '` = ?', [(int) $up]), $table);
        }
        self::assertSame(1, $this->rows('map_objects', '`map_id` = ?', [(int) $m]), 'the other floors keep their objects');
        self::assertSame(3, array_sum($this->storedRefs($m)), 'references of the removed cells are released');
        self::assertSame($this->recountRefs($m), $this->storedRefs($m));
    }

    public function testRemoveInTheSameLotAsContentOps(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $this->opsOk($gm, $m, [self::paletteAdd(1, $asset['id'])]);
        $data = $this->opsOk($gm, $m, [
            self::floorAdd('up', 'Étage', 1),
            self::tiles('up', 'ground', [[1, 1, 1], [2, 2, 1]]),
            self::addObject(self::wallObject('wu', 'up', [[1, 1], [5, 1]])),
            ['type' => 'floor.remove', 'uid' => 'up'],
            self::floorAdd('up', 'Autre', 1),
            self::tiles('up', 'ground', [[5, 5, 1]]),
        ]);
        self::assertSame(6, $data['applied']);
        self::assertSame(0, $this->rows('map_objects', '`map_id` = ?', [(int) $m]));
        self::assertSame(1, array_sum($this->storedRefs($m)));
        self::assertSame($this->recountRefs($m), $this->storedRefs($m));
        // A removed floor is unknown to the ops that follow it.
        $this->opsFail($gm, $m, [['type' => 'floor.remove', 'uid' => 'up'], self::tiles('up', 'ground', [[1, 1, 1]])], ['ops.1.floor' => 'not_found']);
    }

    public function testIdempotenceAndAllOrNothing(): void
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $first = $this->sendOps($gm, $m, [self::floorAdd('up', 'Étage', 1)], null, 'floors-1');
        self::assertSame(200, $first->status());
        $again = $this->sendOps($gm, $m, [self::floorAdd('up', 'Étage', 1)], null, 'floors-1');
        self::assertSame(200, $again->status());
        self::assertSame(self::data($first), self::data($again));
        self::assertCount(2, $this->floorsOf($gm, $m));
        // A refused op undoes the floor.add before it.
        $rev = $this->revision($m);
        $this->opsFail($gm, $m, [self::floorAdd('two', 'Deux', 2), self::floorAdd('up', 'Doublon', 3)], ['ops.1.floor.uid' => 'taken']);
        self::assertCount(2, $this->floorsOf($gm, $m));
        self::assertSame($rev, $this->revision($m));
    }

    public function testASessionOnARemovedFloorMovesToTheFirstRemainingOne(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $this->opsOk($gm, $w['map'], [self::floorAdd('up', 'Étage', 1)]);
        $up = $this->floorId($w['map'], 'up');
        $this->ok($gm->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['map'], 'floor_id' => 'up']));
        self::assertSame($up, (string) $this->db->fetchValue('SELECT `current_floor_id` FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ?', [(int) $w['session']]));
        $head = $this->head();
        $this->opsOk($gm, $w['map'], [['type' => 'floor.remove', 'uid' => 'up']]);
        self::assertSame($w['floor'], (string) $this->db->fetchValue('SELECT `current_floor_id` FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ?', [(int) $w['session']]));
        $changed = array_values(array_filter($this->events($head, $w['channel']), static fn (array $e): bool => $e['type'] === 'map.changed'));
        self::assertCount(1, $changed);
        self::assertSame('all', $changed[0]['audience']);
        self::assertEquals(['map_id' => (int) $w['map'], 'floor_id' => (int) $w['floor']], $changed[0]['payload']);
    }

    public function testRestoringAVersionWithoutTheFloorMovesTheSession(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $v = self::data($this->ok($gm->post('/maps/' . $w['map'] . '/versions', ['label' => 'avant']), 201));
        $this->opsOk($gm, $w['map'], [self::floorAdd('up', 'Étage', 1)]);
        $this->ok($gm->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['map'], 'floor_id' => 'up']));
        $this->ok($gm->post('/maps/' . $w['map'] . '/versions/' . $v['id'] . '/restore', ['client_op_id' => 'r1']));
        self::assertSame(['f1'], array_column($this->floorsOf($gm, $w['map']), 'uid'));
        self::assertSame($w['floor'], (string) $this->db->fetchValue('SELECT `current_floor_id` FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ?', [(int) $w['session']]));
    }
}
