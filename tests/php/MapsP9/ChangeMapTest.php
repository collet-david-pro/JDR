<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9;

/**
 * POST /sessions/{id}/change-map extended (P9a1, D2: the GM travels, players never) and the
 * one-floor filtering of what players and screens receive.
 */
final class ChangeMapTest extends MapsP9TestCase
{
    private function session(): array
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $other = $this->newMap($gm, $w['game'], ['name' => 'Autre', 'width' => 50, 'height' => 50]);
        $this->opsOk($gm, $w['map'], [self::floorAdd('up', 'Étage', 1)]);
        $guard = $this->newToken($gm, $w['game'], ['name' => 'Garde', 'kind' => 'npc']);
        $this->fill($gm, $w['map'], [self::wallObject('w-up', 'up', [[1, 1], [9, 1]]), self::wallObject('w-down', 'f1', [[1, 1], [9, 1]])], [
            self::placedToken('t1', 'f1', (string) $guard['id'], 2, 2),
            self::placedToken('t2', 'f1', (string) $guard['id'], 3, 2, ['hidden' => true]),
            self::placedToken('t3', 'f1', (string) $guard['id'], 4, 2),
        ]);

        return $w + ['other' => $other, 'guard' => $guard];
    }

    private function current(array $w): array
    {
        $r = $this->db->fetchAll('SELECT `current_map_id` m, `current_floor_id` f, `camera` c FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ?', [(int) $w['session']])[0];

        return [(string) $r['m'], (string) $r['f'], $r['c'] === null ? null : json_decode((string) $r['c'], true)];
    }

    public function testFloorByUidFocusAndNoReadyResetForAFloorChange(): void
    {
        $w = $this->session();
        $gm = $w['gm'];
        $path = '/sessions/' . $w['session'] . '/change-map';
        $this->ok($w['bob']->post('/sessions/' . $w['session'] . '/ready', ['ready' => true]), 204);
        $head = $this->head();
        $this->ok($gm->post($path, ['map_id' => $w['map'], 'floor_id' => 'up', 'focus' => ['x' => 6.5, 'y' => 7]]));
        [$map, $floor, $camera] = $this->current($w);
        self::assertSame([$w['map'], $this->floorId($w['map'], 'up')], [$map, $floor]);
        self::assertEquals(['x' => 6.5, 'y' => 7, 'zoom' => 1, 'floor_id' => (int) $floor, 'follow' => false], $camera);
        self::assertTrue($this->isReady($w['session'], 'Bob'), 'a floor change keeps the ready flags');
        self::assertContains('map.changed/all', $this->kinds($head, $w['channel']));
        $this->ok($gm->post($path, ['map_id' => $w['other']['id']]));
        self::assertFalse($this->isReady($w['session'], 'Bob'), 'a map change resets them');
        // Errors.
        foreach ([['floor_id' => 'nope', 'f' => 'floor_id', 'e' => 'not_found'], ['floor_id' => 'a/b', 'f' => 'floor_id', 'e' => 'invalid']] as $c) {
            self::assertFieldErrors($gm->post($path, ['map_id' => $w['map'], 'floor_id' => $c['floor_id']]), [$c['f'] => $c['e']]);
        }
        self::assertFieldErrors($gm->post($path, ['map_id' => $w['map'], 'focus' => ['x' => 'a', 'y' => 1]]), ['focus' => 'invalid']);
        self::assertFieldErrors($gm->post($path, ['map_id' => $w['map'], 'move_tokens' => ['t1']]), ['focus' => 'required']);
    }

    public function testPlayersAndOutsidersCannotTravel(): void
    {
        $w = $this->session();
        $before = $this->current($w);
        foreach (['bob', 'co', 'dan'] as $who) {
            $r = $w[$who]->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['other']['id']]);
            self::assertSame($who === 'co' ? 200 : 403, $r->status(), $who);
            if ($who === 'co') {
                $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['map']]));
            }
        }
        self::assertSame(404, $w['eve']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['other']['id']])->status());
        self::assertSame($before[0], $this->current($w)[0]);
        // A stairs / portal does nothing for a player: no endpoint, actions refuse unknown kinds.
        $this->opsOk($w['gm'], $w['map'], [self::addObject(self::stairs('s', 'f1', 'up'))]);
        $this->startSession($w);
        self::assertSame(422, $this->act($w['bob'], $w['session'], [['type' => 'stairs.use', 'uid' => 's']])->status());
        self::assertSame($before[1], $this->current($w)[1]);
    }

    public function testMoveTokensToAnotherFloorOfTheSameMap(): void
    {
        $w = $this->session();
        $up = $this->floorId($w['map'], 'up');
        $head = $this->head();
        $rev = $this->revision($w['map']);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/change-map', [
            'map_id' => $w['map'], 'floor_id' => 'up', 'focus' => ['x' => 5.5, 'y' => 5.5], 'move_tokens' => ['t1', 't2'],
        ]));
        $rows = $this->db->fetchAll('SELECT `uid`, `floor_id`, `x`, `y`, `hidden`, `token_id` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? ORDER BY `uid`', [(int) $w['map']]);
        self::assertSame(['t1', 't2', 't3'], array_column($rows, 'uid'));
        self::assertSame([$up, $up, $w['floor']], array_map('strval', array_column($rows, 'floor_id')));
        self::assertSame([5.5, 5.0], [(float) $rows[0]['x'], (float) $rows[0]['y']] === [5.5, 5.5] ? [5.5, 5.0] : [0.0, 0.0], 'first token on the focus');
        self::assertNotSame([(float) $rows[0]['x'], (float) $rows[0]['y']], [(float) $rows[1]['x'], (float) $rows[1]['y']], 'tokens do not stack');
        self::assertSame('1', (string) $rows[1]['hidden'], 'hidden kept');
        self::assertSame($rev + 1, $this->revision($w['map']));
        $types = array_column($this->events($head), 'type');
        self::assertContains('map.ops', $types);
        self::assertContains('maptoken.removed', $types);
        self::assertContains('maptoken.added', $types);
        self::assertContains('map.changed', $types);
        self::assertContains('camera.moved', $types);
    }

    public function testMoveTokensToAnotherMapAvoidsWallsAndKeepsAssignments(): void
    {
        $w = $this->session();
        $gm = $w['gm'];
        $o = (string) $w['other']['id'];
        $of = (string) $w['other']['floors'][0]['id'];
        $this->opsOk($gm, $o, [self::addObject(self::wallObject('ring', $of, [[10, 10], [10, 10.5]])), self::addObject(self::wallObject('wall', $of, [[9, 10.5], [12, 10.5]]))]);
        $this->fill($gm, $o, [], [self::placedToken('t1', $of, (string) $w['guard']['id'], 11.5, 11.5)]);
        $this->ok($gm->put('/sessions/' . $w['session'] . '/assignments/' . $w['guard']['id'], ['user_id' => (string) $this->userId('Bob')]));
        $this->ok($gm->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $o, 'focus' => ['x' => 11.5, 'y' => 10.9], 'move_tokens' => ['t1', 't3']]));
        self::assertSame(0, $this->rows('map_tokens', '`map_id` = ? AND `uid` IN (?, ?)', [(int) $w['map'], 't1', 't3']));
        $rows = $this->db->fetchAll('SELECT `uid`, `x`, `y`, `token_id` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ?', [(int) $o]);
        self::assertCount(3, $rows, 'the target already held t1: the traveller gets a new uid, nothing is lost');
        foreach ($rows as $r) {
            if ((float) $r['x'] === 11.5 && (float) $r['y'] === 11.5) {
                continue;
            }
            self::assertGreaterThan(0.4, abs((float) $r['y'] - 10.5) <= 0.4 && (float) $r['x'] >= 9 && (float) $r['x'] <= 12 ? 0.0 : 1.0, 'not on the wall');
        }
        self::assertSame((int) $w['guard']['id'], (int) $rows[0]['token_id']);
        self::assertSame(1, $this->rows('token_assignments', '`token_id` = ?', [(int) $w['guard']['id']]), 'assignments follow the definition');
    }

    public function testFailureMovesNothing(): void
    {
        $w = $this->session();
        $before = $this->db->fetchAll('SELECT `uid`, `floor_id`, `x` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? ORDER BY `uid`', [(int) $w['map']]);
        $r = $w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['other']['id'], 'focus' => ['x' => 5, 'y' => 5], 'move_tokens' => ['t1', 'ghost']]);
        self::assertFieldErrors($r, ['move_tokens.1' => 'not_found']);
        self::assertSame($before, $this->db->fetchAll('SELECT `uid`, `floor_id`, `x` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? ORDER BY `uid`', [(int) $w['map']]));
        self::assertSame($w['map'], $this->current($w)[0]);
    }

    public function testPlayersAndScreensOnlyGetTheCurrentFloor(): void
    {
        $w = $this->session();
        $gm = $w['gm'];
        $this->setSettings($w, ['fog_strict' => false, 'players_see_other_pcs' => true]);
        $this->startSession($w);
        $snap = static fn (array $w): array => self::data($w['bob']->get('/sessions/' . $w['session'] . '/snapshot'));
        $s = $snap($w);
        self::assertSame(['w-down'], array_column($s['map']['objects'], 'uid'));
        self::assertSame(['t1', 't3'], array_column($s['map']['tokens_placed'], 'uid'));
        self::assertSame([$w['floor']], array_column($s['map']['floors'], 'id'));
        // Editing the other floor sends nothing to the players.
        $head = $this->head();
        $this->opsOk($gm, $w['map'], [self::addObject(self::wallObject('w-up2', 'up', [[1, 3], [9, 3]])), self::tiles('up', 'ground', [[1, 1, 0]])]);
        $public = array_values(array_filter($this->events($head, $w['channel']), static fn (array $e): bool => $e['audience'] !== 'gm'));
        foreach ($public as $e) {
            self::assertStringNotContainsString('w-up2', json_encode($e));
            if ($e['type'] === 'map.ops.public') {
                self::assertSame([], $e['payload']['objects']['upsert'] ?? []);
            }
        }
        // Chunks of another floor: nothing.
        self::assertSame('', $w['bob']->get('/maps/' . $w['map'] . '/chunks?floor=up')->body());
        // Travel: the players get the new floor only.
        $this->ok($gm->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['map'], 'floor_id' => 'up']));
        $s = $snap($w);
        self::assertSame(['w-up', 'w-up2'], array_column($s['map']['objects'], 'uid'));
        self::assertSame([], $s['map']['tokens_placed']);
    }

    public function testLinksNeverReachPlayers(): void
    {
        $w = $this->session();
        $gm = $w['gm'];
        $link = ['map_id' => $w['other']['id']];
        $door = self::doorObject('d-link', 'f1', [5, 5], [6, 5]);
        $door['props']['link'] = $link;
        $this->opsOk($gm, $w['map'], [self::addObject($door), self::addObject(self::portal('p-link', 'f1', $link)), self::addObject(self::stairs('s-link', 'f1', 'up', [], ['link' => $link]))]);
        $this->setSettings($w, ['fog_strict' => false, 'players_see_other_pcs' => true]);
        $this->startSession($w);
        $snapshot = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/snapshot')));
        $byUid = array_column($snapshot['map']['objects'], null, 'uid');
        foreach (['d-link', 'p-link', 's-link'] as $uid) {
            self::assertArrayNotHasKey('link', $byUid[$uid]['props'], $uid);
        }
        self::assertSame('portal', $byUid['p-link']['props']['icon']);
        self::assertSame('up', $byUid['s-link']['props']['direction']);
        $gmSnap = self::data($this->ok($gm->get('/sessions/' . $w['session'] . '/snapshot')));
        self::assertArrayHasKey('link', array_column($gmSnap['map']['objects'], null, 'uid')['p-link']['props']);
        // Live edit: the public event has no link either.
        $head = $this->head();
        $this->opsOk($gm, $w['map'], [self::addObject(self::portal('p-live', 'f1', $link))]);
        $public = array_filter($this->events($head, $w['channel']), static fn (array $e): bool => $e['type'] === 'map.ops.public');
        self::assertNotEmpty($public);
        foreach ($public as $e) {
            self::assertStringNotContainsString('"link"', json_encode($e));
            self::assertStringContainsString('p-live', json_encode($e));
        }
    }
}
