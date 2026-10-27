<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

use JDR\Domain\Sessions\EventTypes;

/**
 * P7b: the "table" view of the projection screens (D5 viewers, D6 fan-out, D7 reads, states) and
 * the signed URL of the pause screen (D11).
 *
 * Scene (bigScene): Bob's elf (5, 5), Dan's dwarf (9, 9), goblin (8, 5), far goblin (170, 170),
 * hidden dragon; plus a free PC t-free (100, 100), a hidden free PC t-ghost-pc (60, 60), Dan's
 * familiar t-pet (monster, assigned, 40, 40), a torch (7, 9), tiles in blocks 0:0, 1:1, 3:3, 4:4.
 */
final class DisplayTableViewTest extends DisplaysTestCase
{
    /**
     * @param array<string, bool> $settings
     * @return array<string, mixed>
     */
    private function tableScene(array $settings, bool $start = true, bool $screen = true): array
    {
        $w = $this->bigScene(false);
        $gm = $w['gm'];
        $f = $w['bigFloor'];
        $free = $this->newToken($gm, $w['game'], ['name' => 'Errant', 'kind' => 'pc']);
        $ghost = $this->newToken($gm, $w['game'], ['name' => 'Revenant', 'kind' => 'pc']);
        $pet = $this->newToken($gm, $w['game'], ['name' => 'Familier', 'kind' => 'monster']);
        $this->opsOk($gm, $w['big'], [self::tiles($f, 'ground', [[40, 40, 1], [100, 100, 1]])]);
        $this->fill($gm, $w['big'], [[
            'uid' => 'torch', 'floor' => $f, 'type' => 'light', 'layer' => 'lighting', 'geometry' => ['x' => 7, 'y' => 9],
            'props' => ['radius' => 2, 'dim_radius' => 3, 'color' => '#ffcc88', 'intensity' => 1,
                'flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 1], 'cone' => null, 'enabled' => true, 'follows_token' => null],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ]], [
            self::placedToken('t-free', $f, (string) $free['id'], 100, 100),
            self::placedToken('t-ghost-pc', $f, (string) $ghost['id'], 60, 60, ['hidden' => true]),
            self::placedToken('t-pet', $f, (string) $pet['id'], 40, 40),
        ]);
        $this->ok($gm->put('/sessions/' . $w['session'] . '/assignments/' . $pet['id'], ['user_id' => (string) $this->userId('Dan')]));
        $this->setSettings($w, $settings);
        if ($screen) {
            [$w['screen'], $w['display']] = $this->pairedScreen($gm, $w['session']);
        }
        if ($start) {
            $this->startSession($w);
        }

        return $w;
    }

    /**
     * @return list<string> "cx:cy" of the blocks of a GET /maps/{id}/chunks body
     */
    private function blocks(string $body): array
    {
        $out = array_map(static fn (array $c): string => $c['cx'] . ':' . $c['cy'], self::parseChunks($body));
        sort($out);

        return array_values(array_unique($out));
    }

    /**
     * @param array<string, mixed> $snapshot
     * @return list<string>
     */
    private static function placedUids(array $snapshot): array
    {
        $uids = array_column($snapshot['map']['tokens_placed'], 'uid');
        sort($uids);

        return $uids;
    }

    public function testViewersAreTheAssignedAndTheFreePcTokensAndWidenTheScope(): void
    {
        $w = $this->tableScene(['fog_strict' => true, 'players_see_other_pcs' => false]);
        $s = $w['session'];
        $snap = self::data($this->ok($w['screen']->get('/sessions/' . $s . '/snapshot?as=display')));
        $viewers = $snap['viewers'];
        sort($viewers);
        self::assertSame(['t-dwarf', 't-elf', 't-free', 't-pet'], $viewers, 'assigned (pc or not) + free pc; npc and hidden excluded');
        self::assertSame(['t-dwarf', 't-elf', 't-free', 't-goblin', 't-pet'], self::placedUids($snap), 'every PC despite players_see_other_pcs; the goblin in scope');
        self::assertArrayNotHasKey('code', $snap['session']);
        self::assertSame([], $snap['session']['players']);
        self::assertSame('display', $snap['session']['role']);
        self::assertCount(3, $snap['session']['assignments']);
        self::assertSame(['token_id', 'user_id'], array_keys($snap['session']['assignments'][0]));
        self::assertSame(array_keys(self::data($this->ok($w['bob']->get('/sessions/' . $s . '/snapshot')))), array_values(array_diff(array_keys($snap), ['viewers'])));

        $bob = self::data($this->ok($w['bob']->get('/sessions/' . $s . '/snapshot')));
        self::assertNotContains('t-dwarf', array_column($bob['map']['tokens_placed'], 'uid'), 'the player still does not see the other PCs');

        // Scope = explored UNION the disks of every viewer: Bob's block 0:0, Dan's familiar 1:1, the free PC 3:3.
        $path = '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'];
        self::assertSame(['0:0', '1:1', '3:3'], $this->blocks($this->ok($w['screen']->get($path . '&as=display'))->body()));
        self::assertSame(['0:0'], $this->blocks($this->ok($w['bob']->get($path))->body()));
        self::assertSame(['0:0', '1:1'], $this->blocks($this->ok($w['dan']->get($path))->body()));
        $palette = [];
        foreach ($snap['map']['palette'] as $entry) {
            if ($entry !== null) {
                $palette[(string) $entry['asset_id']] = $entry['url'];
            }
        }
        self::assertNotNull($palette[(string) $w['a']['id']]);
        self::assertNull($palette[(string) $w['b']['id']], 'tile of block 4:4: outside the table scope');
        $preload = array_map('strval', array_column(self::data($this->ok($w['screen']->get('/sessions/' . $s . '/preload?as=display')))['assets'], 'id'));
        self::assertContains((string) $w['a']['id'], $preload);
        self::assertContains((string) $w['img']['id'], $preload, 'the elf image');
        self::assertNotContains((string) $w['b']['id'], $preload);
        $this->explore($w['big'], $w['bigFloor'], 4, 4);
        $fog = self::data($this->ok($w['screen']->get('/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'] . '&as=display')));
        self::assertSame([[4, 4]], array_map(static fn (array $c): array => [$c[0], $c[1]], $fog['chunks']));
        self::assertContains('4:4', $this->blocks($this->ok($w['screen']->get($path . '&as=display'))->body()), 'an explored block joins the scope');
    }

    public function testWithoutFogStrictTheTableSeesEverythingButTheHidden(): void
    {
        $w = $this->tableScene(['fog_strict' => false, 'players_see_other_pcs' => false]);
        $snap = self::data($this->ok($w['screen']->get('/sessions/' . $w['session'] . '/snapshot?as=display')));
        self::assertSame(['t-dwarf', 't-elf', 't-free', 't-goblin', 't-goblin-far', 't-pet'], self::placedUids($snap));
        self::assertSame(['0:0', '1:1', '3:3', '4:4'], $this->blocks($this->ok($w['screen']->get('/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'] . '&as=display'))->body()));
    }

    public function testNoDisplayEventWithoutAnActiveScreen(): void
    {
        $w = $this->tableScene(['fog_strict' => true, 'players_see_other_pcs' => true], true, false);
        $this->makeDisplay($w['gm'], $w['session'], 'En attente');
        $before = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 9, 5), ['type' => 'camera.set', 'x' => 1, 'y' => 1, 'zoom' => 1],
            ['type' => 'door.toggle', 'uid' => 'door-plain'], self::move('t-free', 168, 168)]);
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 6, 6)]);
        self::assertSame([], array_values(array_filter($this->kinds($before), static fn (string $k): bool => str_ends_with($k, '/displays'))));
    }

    public function testTheFanOutWritesTheTableVersionForTheDisplays(): void
    {
        $w = $this->tableScene(['fog_strict' => true, 'players_see_other_pcs' => false]);
        $gm = $w['gm'];
        $s = $w['session'];
        $f = $w['bigFloor'];
        $goblinDef = (string) $this->db->fetchValue('SELECT `token_id` FROM ' . $this->db->t('map_tokens') . " WHERE `uid` = 't-goblin'");
        $before = $this->head();
        $this->actOk($gm, $s, [
            self::move('t-goblin', 9, 5),
            ['type' => 'door.toggle', 'uid' => 'door-plain'],
            ['type' => 'light.toggle', 'uid' => 'torch'],
            ['type' => 'reveal', 'kind' => 'object', 'uid' => 'hidden-vis'],
            ['type' => 'camera.set', 'x' => 10, 'y' => 10, 'zoom' => 1],
            ['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[0, 0, self::b64(self::fogBits(0, 0, 1, 1, 4, 4))]]],
        ]);
        $this->opsOk($gm, $w['big'], [
            ['type' => 'object.add', 'object' => self::wallObject('wall-new', $f, [[3, 12], [4, 12]])],
            ['type' => 'maptoken.add', 'token' => self::placedToken('t-rat', $f, $goblinDef, 7, 12)],
        ]);
        $this->opsOk($gm, $w['big'], [['type' => 'maptoken.remove', 'uid' => 't-rat']]);
        $events = $this->events($before);
        $display = array_values(array_filter($events, static fn (array $e): bool => $e['audience'] === 'displays'));
        $types = array_values(array_unique(array_column($display, 'type')));
        foreach ([EventTypes::TOKEN_MOVED, EventTypes::DOOR_TOGGLED, EventTypes::LIGHT_CHANGED, EventTypes::OBJECT_REVEALED, EventTypes::CAMERA_MOVED,
            EventTypes::FOG_UPDATED, EventTypes::MAP_OPS_PUBLIC, EventTypes::TOKEN_ADDED, EventTypes::TOKEN_REMOVED] as $type) {
            self::assertContains($type, $types, $type);
        }
        foreach ($display as $e) {
            if ($e['type'] === EventTypes::CAMERA_MOVED) {
                $players = array_values(array_filter($events, static fn (array $p): bool => $p['type'] === EventTypes::CAMERA_MOVED && $p['audience'] === 'players'));
                self::assertSame($players[0]['payload'], $e['payload'], 'camera.moved: the payload of the players');
                self::assertSame(1, (int) $e['ephemeral']);
            } else {
                self::assertSame('display', $e['payload']['view'], $e['type']);
            }
        }
        $read = self::data($this->ok($w['screen']->get('/events?as=display&channels=' . $w['channel'] . '&since=' . $before)));
        self::assertSame(array_column($display, 'type'), array_values(array_filter(array_column($read['events'], 'type'), static fn (string $t): bool => in_array($t, $types, true))));

        // The free PC walks away: what enters the table scope is sent to the displays only.
        $before = $this->head();
        $this->actOk($gm, $s, [self::move('t-free', 168, 168)]);
        $added = array_values(array_filter($this->events($before), static fn (array $e): bool => $e['type'] === EventTypes::TOKEN_ADDED && ($e['payload']['uid'] ?? null) === 't-goblin-far'));
        self::assertSame(['displays'], array_column($added, 'audience'));
        $ops = array_values(array_filter($this->events($before), static fn (array $e): bool => $e['type'] === EventTypes::MAP_OPS_PUBLIC));
        self::assertSame(['displays'], array_values(array_unique(array_column($ops, 'audience'))));
        self::assertContains([$f, 4, 4], $ops[0]['payload']['chunks']);

        // The hidden free PC revealed: a new viewer for the table.
        $before = $this->head();
        $this->actOk($gm, $s, [['type' => 'reveal', 'kind' => 'token', 'uid' => 't-ghost-pc']]);
        $added = array_values(array_filter($this->events($before), static fn (array $e): bool => $e['type'] === EventTypes::TOKEN_ADDED && $e['audience'] === 'displays'));
        self::assertSame(['t-ghost-pc'], array_column(array_column($added, 'payload'), 'uid'));

        // Pause: nothing for the displays.
        $this->ok($gm->post('/sessions/' . $s . '/pause'));
        $before = $this->head();
        $this->actOk($gm, $s, [self::move('t-goblin', 10, 5), ['type' => 'camera.set', 'x' => 2, 'y' => 2, 'zoom' => 1], self::move('t-free', 100, 100)]);
        self::assertSame([], array_values(array_filter($this->kinds($before), static fn (string $k): bool => str_ends_with($k, '/displays'))));
    }

    public function testStatesAndOtherSessions(): void
    {
        $w = $this->tableScene(['fog_strict' => true, 'players_see_other_pcs' => true], false);
        $s = $w['session'];
        $screen = $w['screen'];
        $chunks = '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'] . '&as=display';
        $fog = '/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'] . '&as=display';

        $lobby = self::data($this->ok($screen->get('/sessions/' . $s . '/snapshot?as=display')));
        self::assertNull($lobby['map']);
        self::assertSame([], $lobby['viewers']);
        self::assertSame((int) $w['big'], (int) self::data($this->ok($screen->get('/sessions/' . $s . '/preload?as=display')))['map_id']);
        self::assertSame(404, $screen->get($chunks)->status(), 'lobby: not running');

        $this->startSession($w);
        self::assertNotNull(self::data($this->ok($screen->get('/sessions/' . $s . '/snapshot?as=display')))['map']);
        $this->ok($screen->get($chunks));
        $this->ok($screen->get($fog));
        $other = $this->newMap($w['gm'], $w['game'], ['name' => 'Autre']);
        self::assertSame(404, $screen->get('/maps/' . $other['id'] . '/chunks?as=display')->status(), 'not the current map');
        self::assertSame(404, $screen->get('/maps/' . $other['id'] . '/fog?as=display')->status());
        $otherSession = $this->newSession((int) $w['game'], 'running');
        foreach (['snapshot', 'preload'] as $read) {
            self::assertSame(404, $screen->get('/sessions/' . $otherSession . '/' . $read . '?as=display')->status(), $read . ' of another session');
        }

        $this->ok($w['gm']->post('/sessions/' . $s . '/pause'));
        foreach (['/sessions/' . $s . '/snapshot?as=display', '/sessions/' . $s . '/preload?as=display', $chunks, $fog] as $path) {
            $r = $screen->get($path);
            self::assertSame(409, $r->status(), 'paused ' . $path);
            self::assertSame('session_paused', self::errorCode($r));
        }

        $this->setState($s, 'ended'); // forced: the API end would revoke the screen (P7g)
        self::assertNull(self::data($this->ok($screen->get('/sessions/' . $s . '/snapshot?as=display')))['map']);
        $r = $screen->get('/sessions/' . $s . '/preload?as=display');
        self::assertSame(409, $r->status());
        self::assertSame('session_not_running', self::errorCode($r));
        self::assertSame(404, $screen->get($chunks)->status());
        self::assertSame(404, $screen->get($fog)->status());
    }

    public function testThePauseScreenHasASignedUrlForEveryReader(): void
    {
        $w = $this->arena();
        $s = $w['session'];
        [$screen] = $this->pairedScreen($w['gm'], $s);
        $asset = $this->uploadOk($w['gm'], 'valid_png_opaque.png', ['kind' => 'background']);
        $this->ok($w['gm']->patch('/sessions/' . $s, ['pause_screen' => ['asset_id' => $asset['id'], 'text' => 'Pause']]));

        $urls = [
            'gm' => [$w['gm'], self::data($this->ok($w['gm']->get('/sessions/' . $s)))['pause_screen']],
            'player' => [$w['bob'], self::data($this->ok($w['bob']->get('/sessions/' . $s)))['pause_screen']],
            'player snapshot' => [$w['bob'], self::data($this->ok($w['bob']->get('/sessions/' . $s . '/snapshot')))['session']['pause_screen']],
            'screen' => [$screen, self::data($this->ok($screen->get('/display/me')))['session']['pause_screen']],
            'screen snapshot' => [$screen, self::data($this->ok($screen->get('/sessions/' . $s . '/snapshot?as=display')))['session']['pause_screen']],
        ];
        foreach ($urls as $who => [$client, $pause]) {
            self::assertSame(['asset_id', 'text', 'url'], array_keys($pause), $who);
            self::assertSame('Pause', $pause['text']);
            self::assertIsString($pause['url'], $who);
            self::assertStringContainsString('/files/' . $asset['uuid'], $pause['url']);
            $file = $this->fetchUrl($client, $pause['url']);
            self::assertSame(200, $file->status(), $who);
        }
        $list = self::data($this->ok($w['gm']->get('/games/' . $w['game'] . '/sessions')));
        self::assertIsString($list[0]['pause_screen']['url']);

        $this->ok($w['gm']->patch('/sessions/' . $s, ['pause_screen' => ['asset_id' => null, 'text' => 'Café']]));
        self::assertNull(self::data($this->ok($w['gm']->get('/sessions/' . $s)))['pause_screen']['url']);
        self::assertNull(self::data($this->ok($screen->get('/display/me')))['session']['pause_screen']['url']);
        $this->ok($w['gm']->patch('/sessions/' . $s, ['pause_screen' => null]));
        self::assertNull(self::data($this->ok($screen->get('/display/me')))['session']['pause_screen']);
    }
}
