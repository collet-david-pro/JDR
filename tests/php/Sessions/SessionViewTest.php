<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

/**
 * Snapshot and preload (P6b): GM view, filtered player view (PlayerFilter, players_see_other_pcs,
 * fog_strict), pause (D5), lobby, ended, last_event_id.
 */
final class SessionViewTest extends SessionsTestCase
{
    private function snapshot(array $w, string $who): array
    {
        return self::data($this->ok($w[$who]->get('/sessions/' . $w['session'] . '/snapshot')));
    }

    /**
     * @param array<string, mixed> $snap
     * @return list<string>
     */
    private static function uids(array $snap, string $key): array
    {
        $uids = array_column($snap['map'][$key], 'uid');
        sort($uids);

        return $uids;
    }

    public function testGmSnapshotIsComplete(): void
    {
        $w = $this->bigScene();
        $snap = $this->snapshot($w, 'gm');

        self::assertSame($w['code'], $snap['session']['code']);
        self::assertSame($w['big'], $snap['map']['id']);
        self::assertSame(
            ['door-plain', 'door-secret', 'gm-layer', 'gm-vis', 'hidden-vis', 'wall-far', 'wall-near'],
            self::uids($snap, 'objects'),
        );
        self::assertSame(['t-dragon', 't-dwarf', 't-elf', 't-goblin', 't-goblin-far'], self::uids($snap, 'tokens_placed'));
        self::assertSame(['Dragon', 'Elfe', 'Gobelin', 'Nain'], array_column($snap['tokens'], 'name'), 'definitions of the placed tokens, by name');
        self::assertSame($w['bigFloor'], $snap['fog']['floor']);
        self::assertSame([], $snap['fog']['chunks']);
        self::assertSame([], $snap['revealed']);
        self::assertSame($snap['session']['last_event_id'], $snap['last_event_id']);
        self::assertSame((string) $this->head(), $snap['last_event_id']);
        self::assertSame('Grande', $snap['map']['name']);
        self::assertNotSame('', $snap['map']['palette'][1]['name']);
        self::assertNotNull($snap['map']['palette'][1]['url']);
    }

    public function testGmSnapshotWithoutMapAndInLobby(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $s = self::data($this->ok($gm->post('/games/' . $game . '/sessions'), 201));
        $snap = self::data($this->ok($gm->get('/sessions/' . $s['id'] . '/snapshot')));
        self::assertNull($snap['map']);
        self::assertSame([], $snap['tokens']);
        self::assertSame(['floor' => null, 'chunks' => []], $snap['fog']);
        $pre = self::data($this->ok($gm->get('/sessions/' . $s['id'] . '/preload')));
        self::assertSame(['map_id' => null, 'floor_id' => null, 'assets' => [], 'total_bytes' => 0], $pre);
    }

    public function testPlayerSnapshotFogStrict(): void
    {
        $w = $this->bigScene();
        $snap = $this->snapshot($w, 'bob');

        self::assertArrayNotHasKey('code', $snap['session']);
        self::assertSame('player', $snap['session']['role']);
        // Near objects only: no gm calque, no gm / hidden visibility, no far wall.
        self::assertSame(['door-plain', 'door-secret', 'wall-near'], self::uids($snap, 'objects'));
        $objects = array_column($snap['map']['objects'], null, 'uid');
        self::assertSame('wall', $objects['door-secret']['type'], 'a secret door looks like a wall');
        self::assertSame('door', $objects['door-plain']['type']);
        // Own token, the goblin and the dwarf (a pc seen by everybody) near; not the far goblin nor the hidden dragon.
        self::assertSame(['t-dwarf', 't-elf', 't-goblin'], self::uids($snap, 'tokens_placed'));
        self::assertSame(['Elfe', 'Gobelin', 'Nain'], array_column($snap['tokens'], 'name'));
        self::assertNull($snap['map']['thumb_url']);
        self::assertSame([], $snap['map']['notes']);
        self::assertSame([], $snap['revealed']);
        // Palette: names stripped, only the asset of the authorized blocks has a URL.
        $palette = $snap['map']['palette'];
        self::assertNull($palette[0]);
        self::assertSame('', $palette[1]['name']);
        self::assertNotNull($palette[1]['url']);
        self::assertSame($w['a']['id'], $palette[1]['asset_id']);
        self::assertNull($palette[2]['url']);
        self::assertNull($palette[2]['thumb_url']);
        self::assertSame($w['b']['id'], $palette[2]['asset_id']);
        // The image of the elf is signed, the dwarf (no image) has none.
        self::assertNotNull($snap['tokens'][0]['image']);

        $json = json_encode($snap);
        foreach (['wall-far', 'gm-layer', 'gm-vis', 'hidden-vis', 't-dragon', 't-goblin-far', 'Dragon', $w['code']] as $secret) {
            self::assertStringNotContainsString($secret, (string) $json, $secret);
        }
        self::assertStringNotContainsString('"secret":true', (string) $json);
    }

    public function testPlayerSnapshotWithoutFogStrict(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->patch('/games/' . $w['game'], ['settings' => ['fog_strict' => false]]));
        $snap = $this->snapshot($w, 'bob');
        self::assertSame(['door-plain', 'door-secret', 'wall-far', 'wall-near'], self::uids($snap, 'objects'));
        self::assertSame(['t-dwarf', 't-elf', 't-goblin', 't-goblin-far'], self::uids($snap, 'tokens_placed'));
        self::assertNotNull($snap['map']['palette'][2]['url']);
        self::assertFalse($snap['session']['settings']['fog_strict']);
        $json = (string) json_encode($snap);
        foreach (['gm-layer', 'gm-vis', 'hidden-vis', 't-dragon', 'Dragon'] as $secret) {
            self::assertStringNotContainsString($secret, $json, $secret);
        }
    }

    public function testExploredFogOpensBlocks(): void
    {
        $w = $this->bigScene();
        // The far wall is in block (5, 5); the far goblin at (170, 170) too.
        $this->explore($w['big'], $w['bigFloor'], 5, 5);
        $snap = $this->snapshot($w, 'bob');
        self::assertContains('wall-far', self::uids($snap, 'objects'));
        self::assertContains('t-goblin-far', self::uids($snap, 'tokens_placed'));
        self::assertCount(1, $snap['fog']['chunks']);
        self::assertSame([5, 5], [$snap['fog']['chunks'][0][0], $snap['fog']['chunks'][0][1]]);
        // Far tile (150, 150) is in block (4, 4): still closed.
        self::assertNull($snap['map']['palette'][2]['url']);
        $this->explore($w['big'], $w['bigFloor'], 4, 4);
        self::assertNotNull($this->snapshot($w, 'bob')['map']['palette'][2]['url']);
    }

    public function testSeeOtherPcsOff(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->patch('/games/' . $w['game'], ['settings' => ['players_see_other_pcs' => false]]));
        $snap = $this->snapshot($w, 'bob');
        self::assertSame(['t-elf', 't-goblin'], self::uids($snap, 'tokens_placed'), 'the dwarf of Dan is not shown to Bob');
        $dan = $this->snapshot($w, 'dan');
        self::assertSame(['t-dwarf', 't-goblin'], self::uids($dan, 'tokens_placed'));
    }

    public function testRevealedObjectsAreSent(): void
    {
        $w = $this->bigScene();
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_objects') . ' SET `revealed_at` = UTC_TIMESTAMP() WHERE `map_id` = ? AND `uid` IN (?, ?, ?)',
            [(int) $w['big'], 'hidden-vis', 'door-secret', 'wall-far'],
        );
        $snap = $this->snapshot($w, 'bob');
        self::assertContains('hidden-vis', self::uids($snap, 'objects'));
        $objects = array_column($snap['map']['objects'], null, 'uid');
        self::assertSame('door', $objects['door-secret']['type'], 'revealed secret door is a door');
        self::assertSame(['door-secret', 'hidden-vis'], $snap['revealed'], 'only revealed objects the player is given');
        self::assertContains('hidden-vis', $this->snapshot($w, 'gm')['revealed']);
        self::assertContains('wall-far', $this->snapshot($w, 'gm')['revealed']);
        self::assertStringNotContainsString('wall-far', (string) json_encode($snap), 'a revealed object outside the scope is not named');
    }

    public function testPauseLobbyEnded(): void
    {
        $w = $this->bigScene(false);
        // Lobby: no map for a player, the header is there.
        $snap = $this->snapshot($w, 'bob');
        self::assertNull($snap['map']);
        self::assertSame([], $snap['tokens']);
        self::assertSame('lobby', $snap['session']['state']);
        self::assertSame((string) $this->head(), $snap['last_event_id']);
        $this->ok($w['bob']->get('/sessions/' . $w['session'] . '/preload'));

        $this->startSession($w);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        foreach (['snapshot', 'preload'] as $what) {
            $response = $w['bob']->get('/sessions/' . $w['session'] . '/' . $what);
            self::assertSame(409, $response->status(), $what);
            self::assertSame('session_paused', self::errorCode($response));
            $this->ok($w['gm']->get('/sessions/' . $w['session'] . '/' . $what));
        }
        $header = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'])));
        self::assertSame('paused', $header['state']);

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/resume'));
        self::assertNotNull($this->snapshot($w, 'bob')['map']);

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertNull($this->snapshot($w, 'bob')['map'], 'ended: no map for a player');
        $response = $w['bob']->get('/sessions/' . $w['session'] . '/preload');
        self::assertSame(409, $response->status());
        self::assertSame('session_not_running', self::errorCode($response));
        self::assertNotNull($this->snapshot($w, 'gm')['map']);
    }

    public function testPreloadListsSignedAssets(): void
    {
        $w = $this->bigScene();
        $gm = self::data($this->ok($w['gm']->get('/sessions/' . $w['session'] . '/preload')));
        self::assertSame($w['big'], $gm['map_id']);
        self::assertSame($w['bigFloor'], $gm['floor_id']);
        self::assertEqualsCanonicalizing([$w['a']['id'], $w['b']['id'], $w['img']['id']], array_column($gm['assets'], 'id'));
        $sum = array_sum(array_column($gm['assets'], 'bytes'));
        self::assertGreaterThan(0, $sum);
        self::assertSame($sum, $gm['total_bytes']);

        $bob = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/preload')));
        self::assertEqualsCanonicalizing([$w['a']['id'], $w['img']['id']], array_column($bob['assets'], 'id'), 'fog_strict: not the far tile');
        self::assertSame(array_sum(array_column($bob['assets'], 'bytes')), $bob['total_bytes']);
        foreach ($bob['assets'] as $asset) {
            self::assertSame(['id', 'url', 'bytes', 'kind'], array_keys($asset));
            self::assertMatchesRegularExpression('#^/api/v1/files/[0-9a-f-]{36}\?t=full&e=\d+&s=[A-Za-z0-9_-]+$#', $asset['url']);
            $file = $w['bob']->get(self::apiPath($asset['url']));
            self::assertSame(200, $file->status());
        }

        $this->explore($w['big'], $w['bigFloor'], 4, 4);
        $bob = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/preload')));
        self::assertContains($w['b']['id'], array_column($bob['assets'], 'id'));

        // The pause screen asset is preloaded too.
        $pause = $this->uploadOk($w['gm'], 'valid_webp_lossless.webp', ['kind' => 'background']);
        $this->ok($w['gm']->patch('/sessions/' . $w['session'], ['pause_screen' => ['asset_id' => $pause['id']]]));
        $bob = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/preload')));
        self::assertContains($pause['id'], array_column($bob['assets'], 'id'));
    }

    public function testPreloadWithoutFogStrictGivesTheWholePalette(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->patch('/games/' . $w['game'], ['settings' => ['fog_strict' => false]]));
        $bob = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'] . '/preload')));
        self::assertContains($w['b']['id'], array_column($bob['assets'], 'id'));
    }

    public function testReconnectionFindsTheTokensAgain(): void
    {
        $w = $this->bigScene();
        $this->ok($w['bob']->post('/sessions/' . $w['session'] . '/leave'), 204);
        $this->ok($w['bob']->post('/sessions/join', ['code' => $w['code']]));
        $snap = $this->snapshot($w, 'bob');
        self::assertContains('t-elf', self::uids($snap, 'tokens_placed'));
        self::assertSame([['token_id' => (string) $w['elf']['id'], 'user_id' => (string) $this->userId('Bob')], ['token_id' => (string) $w['dwarf']['id'], 'user_id' => (string) $this->userId('Dan')]], $snap['session']['assignments']);
    }
}
