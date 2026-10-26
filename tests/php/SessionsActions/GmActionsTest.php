<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * GM actions (contract P6 "Actions de séance"): door.toggle, light.toggle, reveal (object /
 * token), camera.set, ambient.set, note.show — success, persistence, events and their audiences,
 * validation, rights.
 */
final class GmActionsTest extends ActionsTestCase
{
    /**
     * @return array<string, mixed>
     */
    private function lightObject(string $uid, string $floor, float $x, float $y, array $over = []): array
    {
        return array_replace([
            'uid' => $uid, 'floor' => $floor, 'type' => 'light', 'layer' => 'lighting',
            'geometry' => ['x' => $x, 'y' => $y],
            'props' => ['radius' => 4, 'dim_radius' => 6, 'color' => '#ffcc88', 'intensity' => 1,
                'flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 1], 'cone' => null, 'enabled' => true, 'follows_token' => null],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ], $over);
    }

    private function objectRow(string $mapId, string $uid): array
    {
        $row = $this->db->fetchOne('SELECT `props`, `rev`, `revealed_at` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $mapId, $uid]);
        self::assertNotNull($row);

        return ['props' => json_decode((string) $row['props'], true), 'rev' => (int) $row['rev'], 'revealed_at' => $row['revealed_at']];
    }

    /**
     * @return list<array<string, mixed>> events of type $type received by $client on the session channel after $since
     */
    private function got(array $w, string $who, string $type, int $since): array
    {
        return array_values(array_filter($this->received($w[$who], $w['channel'], $since), static fn (array $e): bool => $e['type'] === $type));
    }

    public function testDoorToggle(): void
    {
        $w = $this->bigScene();
        $rev = $this->objectRow($w['big'], 'door-plain')['rev'];
        $head = $this->head();
        self::assertSame([['index' => 0, 'ok' => true, 'uid' => 'door-plain', 'state' => 'open']], $this->actOk($w['gm'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-plain']]));
        self::assertSame('open', $this->objectRow($w['big'], 'door-plain')['props']['state']);
        self::assertSame($rev + 1, $this->objectRow($w['big'], 'door-plain')['rev']);
        self::assertSame(['door.toggled/gm', 'door.toggled/user', 'door.toggled/user'], $this->kinds($head));
        $bob = $this->got($w, 'bob', 'door.toggled', $head);
        self::assertCount(1, $bob);
        self::assertEquals(['uid' => 'door-plain', 'state' => 'open', 'view' => 'player'], $bob[0]['payload']);
        $gm = $this->got($w, 'gm', 'door.toggled', $head);
        self::assertCount(3, $gm, 'a GM reads every audience: his client keeps view = gm');
        // Explicit state equal to the current one: nothing written.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-plain', 'state' => 'open']]);
        self::assertSame($head, $this->head());
        $this->actOk($w['gm'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-plain', 'state' => 'closed']]);
        self::assertSame('closed', $this->objectRow($w['big'], 'door-plain')['props']['state']);
    }

    public function testSecretDoorToggleTellsThePlayersNothing(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-secret']]);
        self::assertSame(['door.toggled/gm'], $this->kinds($head), 'for the players it is still a wall');
        self::assertSame([], $this->got($w, 'bob', 'door.toggled', $head));
    }

    public function testDoorToggleValidation(): void
    {
        $w = $this->bigScene();
        $cases = [
            [['type' => 'door.toggle', 'uid' => 'nope'], ['actions.0.uid' => 'not_found']],
            [['type' => 'door.toggle', 'uid' => 'wall-near'], ['actions.0.uid' => 'invalid']],
            [['type' => 'door.toggle', 'uid' => 'door-plain', 'state' => 'ajar'], ['actions.0.state' => 'invalid']],
            [['type' => 'door.toggle'], ['actions.0.uid' => 'required']],
            [['type' => 'light.toggle', 'uid' => 'door-plain'], ['actions.0.uid' => 'invalid']],
            [['type' => 'light.toggle', 'uid' => 'door-plain', 'enabled' => 'yes'], ['actions.0.enabled' => 'invalid']],
        ];
        foreach ($cases as $i => [$action, $fields]) {
            $r = $this->act($w['gm'], $w['session'], [$action]);
            self::assertSame(422, $r->status(), (string) $i);
            self::assertSame($fields, $r->payload()['error']['fields'], (string) $i);
        }
        self::assertSame(403, $this->act($w['bob'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-plain']])->status());
    }

    public function testLightToggle(): void
    {
        $w = $this->bigScene();
        $this->fill($w['gm'], $w['big'], [
            $this->lightObject('torch', $w['bigFloor'], 6, 6),
            $this->lightObject('gm-light', $w['bigFloor'], 7, 7, ['layer' => 'gm']),
        ]);
        $head = $this->head();
        self::assertSame([['index' => 0, 'ok' => true, 'uid' => 'torch', 'enabled' => false]], $this->actOk($w['gm'], $w['session'], [['type' => 'light.toggle', 'uid' => 'torch']]));
        self::assertFalse($this->objectRow($w['big'], 'torch')['props']['enabled']);
        $bob = $this->got($w, 'bob', 'light.changed', $head);
        self::assertCount(1, $bob);
        self::assertSame('torch', $bob[0]['payload']['uid']);
        self::assertFalse($bob[0]['payload']['props']['enabled']);
        self::assertSame('player', $bob[0]['payload']['view']);
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'light.toggle', 'uid' => 'gm-light', 'enabled' => false]]);
        self::assertSame(['light.changed/gm'], $this->kinds($head), 'a light of the gm layer stays with the GM');
    }

    public function testRevealObject(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        self::assertSame([['index' => 0, 'ok' => true, 'kind' => 'object', 'uid' => 'hidden-vis']], $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 'hidden-vis']]));
        self::assertNotNull($this->objectRow($w['big'], 'hidden-vis')['revealed_at']);
        $bob = $this->got($w, 'bob', 'object.revealed', $head);
        self::assertCount(1, $bob);
        self::assertSame('hidden-vis', $bob[0]['payload']['uid']);
        $snap = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/snapshot')));
        self::assertContains('hidden-vis', array_column($snap['map']['objects'], 'uid'));
        self::assertContains('hidden-vis', $snap['revealed']);
        // Again: nothing more.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 'hidden-vis']]);
        self::assertSame($head, $this->head());
        // A secret door becomes a door for the players.
        $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 'door-secret']]);
        $door = $this->got($w, 'bob', 'object.revealed', $head);
        self::assertCount(1, $door);
        self::assertSame('door', $door[0]['payload']['type']);
        // An object for the GM only stays so.
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 'gm-vis']]);
        self::assertSame(['object.revealed/gm'], $this->kinds($head));
        self::assertSame(['actions.0.uid' => 'not_found'], $this->act($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 't-elf']])->payload()['error']['fields']);
        self::assertSame(['actions.0.kind' => 'required'], $this->act($w['gm'], $w['session'], [['type' => 'reveal', 'uid' => 'hidden-vis']])->payload()['error']['fields']);
    }

    public function testRevealToken(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'token', 'uid' => 't-dragon']]);
        self::assertFalse($this->placed($w['big'], 't-dragon')['hidden']);
        self::assertSame(['maptoken.updated/gm', 'maptoken.added/user', 'maptoken.added/user'], $this->kinds($head));
        $bob = $this->got($w, 'bob', 'maptoken.added', $head);
        self::assertSame('t-dragon', $bob[0]['payload']['uid']);
        self::assertFalse($bob[0]['payload']['hidden']);
        self::assertSame(['actions.0.uid' => 'not_found'], $this->act($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'token', 'uid' => 'door-plain']])->payload()['error']['fields']);
    }

    public function testCamera(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $results = $this->actOk($w['gm'], $w['session'], [['type' => 'camera.set', 'x' => 10.5, 'y' => 4, 'zoom' => 1.5]]);
        self::assertTrue($results[0]['ok']);
        $session = self::data($this->ok($w['gm']->get('/sessions/' . $w['session'])));
        self::assertEquals(['x' => 10.5, 'y' => 4, 'zoom' => 1.5, 'floor_id' => $w['bigFloor'], 'follow' => true], $session['camera']);
        self::assertSame(['camera.moved/players'], $this->kinds($head));
        self::assertSame(1, (int) $this->events($head)[0]['ephemeral']);
        $bob = $this->got($w, 'bob', 'camera.moved', $head);
        self::assertEquals(['x' => 10.5, 'y' => 4, 'zoom' => 1.5, 'floor_id' => $w['bigFloor'], 'follow' => true], $bob[0]['payload']);
        $cases = [
            [['type' => 'camera.set', 'x' => 1, 'y' => 1, 'zoom' => 9], ['actions.0.zoom' => 'too_large']],
            [['type' => 'camera.set', 'x' => 1, 'y' => 1], ['actions.0.zoom' => 'required']],
            [['type' => 'camera.set', 'x' => 1, 'y' => 1, 'zoom' => 1, 'floor_id' => '999999'], ['actions.0.floor_id' => 'not_found']],
            [['type' => 'camera.set', 'x' => 1, 'y' => 1, 'zoom' => 1, 'follow' => 1], ['actions.0.follow' => 'invalid']],
        ];
        foreach ($cases as $i => [$action, $fields]) {
            self::assertSame($fields, $this->act($w['gm'], $w['session'], [$action])->payload()['error']['fields'], (string) $i);
        }
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'camera.set', 'x' => 1, 'y' => 1, 'zoom' => 1, 'follow' => false]]);
        self::assertSame(['camera.moved/gm'], $this->kinds($head), 'D5');
    }

    public function testAmbient(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $results = $this->actOk($w['gm'], $w['session'], [['type' => 'ambient.set', 'ambient' => ['darkness' => 0.6, 'weather' => ['type' => 'rain']]]]);
        self::assertEqualsWithDelta(0.6, $results[0]['ambient']['darkness'], 1e-9);
        $map = self::data($this->ok($w['gm']->get('/maps/' . $w['big'])));
        self::assertEqualsWithDelta(0.6, $map['ambient']['darkness'], 1e-9);
        self::assertSame('rain', $map['ambient']['weather']['type']);
        self::assertSame(['ambient.changed/all'], $this->kinds($head));
        $bob = $this->got($w, 'bob', 'ambient.changed', $head);
        self::assertSame('rain', $bob[0]['payload']['ambient']['weather']['type']);
        self::assertSame(['actions.0.ambient.darkness' => 'too_large'], $this->act($w['gm'], $w['session'], [['type' => 'ambient.set', 'ambient' => ['darkness' => 2]]])->payload()['error']['fields']);
        self::assertSame(['actions.0.ambient' => 'invalid'], $this->act($w['gm'], $w['session'], [['type' => 'ambient.set', 'ambient' => ['sun' => 1]]])->payload()['error']['fields']);
        self::assertSame(['actions.0.ambient' => 'required'], $this->act($w['gm'], $w['session'], [['type' => 'ambient.set']])->payload()['error']['fields']);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [['type' => 'ambient.set', 'ambient' => ['darkness' => 0.1]]]);
        self::assertSame(['ambient.changed/gm'], $this->kinds($head), 'D5');
    }

    public function testNote(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        self::assertSame([['index' => 0, 'ok' => true]], $this->actOk($w['gm'], $w['session'], [['type' => 'note.show', 'title' => ' La porte ', 'body' => "Une voix.\nGrave."]]));
        self::assertSame(['note.read_aloud/all'], $this->kinds($head));
        self::assertEquals(['title' => 'La porte', 'body' => "Une voix.\nGrave."], $this->got($w, 'bob', 'note.read_aloud', $head)[0]['payload']);
        $cases = [
            [['type' => 'note.show', 'body' => 'x'], ['actions.0.title' => 'required']],
            [['type' => 'note.show', 'title' => str_repeat('a', 121)], ['actions.0.title' => 'too_long']],
            [['type' => 'note.show', 'title' => 'a', 'body' => str_repeat('b', 4001)], ['actions.0.body' => 'too_long']],
            [['type' => 'note.show', 'title' => 'a', 'body' => 3], ['actions.0.body' => 'invalid']],
        ];
        foreach ($cases as $i => [$action, $fields]) {
            self::assertSame($fields, $this->act($w['gm'], $w['session'], [$action])->payload()['error']['fields'], (string) $i);
        }
    }
}
