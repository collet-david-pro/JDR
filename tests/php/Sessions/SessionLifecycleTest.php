<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

/**
 * Create, list, show, patch, transitions, regenerate-code and change-map (P6b).
 */
final class SessionLifecycleTest extends SessionsTestCase
{
    public function testCreateReturnsLobbySessionWithCode(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $map = $this->newMap($gm, $game);
        $before = $this->head();

        $response = $this->ok($gm->post('/games/' . $game . '/sessions', ['name' => '  Séance 4 ', 'map_id' => $map['id'], 'floor_id' => $map['floors'][0]['id']]), 201);
        $s = self::data($response);

        self::assertMatchesRegularExpression('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', $s['code']);
        self::assertSame('Séance 4', $s['name']);
        self::assertSame('lobby', $s['state']);
        self::assertSame($game, $s['game_id']);
        self::assertSame((string) $map['id'], $s['current_map_id']);
        self::assertSame((string) $map['floors'][0]['id'], $s['current_floor_id']);
        self::assertNull($s['camera']);
        self::assertNull($s['pause_screen']);
        self::assertNull($s['started_at']);
        self::assertNull($s['ended_at']);
        self::assertSame([], $s['players']);
        self::assertSame([], $s['assignments']);
        self::assertSame('gm', $s['role']);
        self::assertSame(
            ['fog_strict' => true, 'players_blocked_by_walls' => true, 'players_can_move_own_tokens' => true, 'players_see_other_pcs' => true],
            $s['settings'],
        );
        self::assertIsString($s['last_event_id']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $s['created_at']);

        $kinds = $this->kinds($before);
        self::assertSame(['session.state/all'], $kinds);
        $event = $this->events($before)[0];
        self::assertSame('session:' . $s['id'], $event['channel']);
        self::assertEquals(
            ['state' => 'lobby', 'current_map_id' => (string) $map['id'], 'floor_id' => (string) $map['floors'][0]['id'], 'pause_screen' => null],
            $event['payload'],
        );
        self::assertSame($this->userId('Alice'), (int) $event['actor_user_id']);
    }

    public function testCreateWithoutMapAndFirstFloorByDefault(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $s = self::data($this->ok($gm->post('/games/' . $game . '/sessions'), 201));
        self::assertNull($s['name']);
        self::assertNull($s['current_map_id']);

        $map = $this->newMap($gm, $game);
        $this->ok($gm->post('/sessions/' . $s['id'] . '/end'));
        $t = self::data($this->ok($gm->post('/games/' . $game . '/sessions', ['map_id' => $map['id']]), 201));
        self::assertSame((string) $map['floors'][0]['id'], $t['current_floor_id']);
    }

    public function testOneOpenSessionPerGame(): void
    {
        $w = $this->arena();
        $response = $w['gm']->post('/games/' . $w['game'] . '/sessions');
        self::assertSame(409, $response->status());
        self::assertSame('session_exists', self::errorCode($response));
        self::assertSame($w['session'], $response->payload()['error']['fields']['session_id']);
        self::assertSame(1, $this->rows('play_sessions'));

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        $this->ok($w['gm']->post('/games/' . $w['game'] . '/sessions'), 201);
        self::assertSame(2, $this->rows('play_sessions'));
    }

    public function testCreateValidation(): void
    {
        $w = $this->arena();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        $gm = $w['gm'];
        $path = '/games/' . $w['game'] . '/sessions';
        self::assertFieldErrors($gm->post($path, ['name' => str_repeat('x', 121)]), ['name' => 'too_long']);
        self::assertFieldErrors($gm->post($path, ['name' => 12]), ['name' => 'invalid']);
        self::assertFieldErrors($gm->post($path, ['map_id' => 'abc']), ['map_id' => 'invalid']);
        self::assertFieldErrors($gm->post($path, ['map_id' => '999999']), ['map_id' => 'not_found']);
        self::assertFieldErrors($gm->post($path, ['floor_id' => $w['floor']]), ['map_id' => 'required']);
        self::assertFieldErrors($gm->post($path, ['map_id' => $w['map'], 'floor_id' => '999999']), ['floor_id' => 'not_found']);
        self::assertFieldErrors($gm->post($path, ['client_op_id' => str_repeat('a', 41)]), ['client_op_id' => 'invalid']);
        self::assertSame(1, $this->rows('play_sessions'), 'nothing created');

        // A map of another game is not accepted.
        $other = (string) $this->newGame($gm, 'Autre')['id'];
        $foreign = $this->newMap($gm, $other);
        self::assertFieldErrors($gm->post($path, ['map_id' => $foreign['id']]), ['map_id' => 'not_found']);
    }

    public function testDefaultOwnersArePreAssigned(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $this->addMember($gm, $game, 'Bob');
        $this->addMember($gm, $game, 'Carl', 'co_gm');
        $bob = $this->userId('Bob');
        $t1 = $this->newToken($gm, $game, ['name' => 'Elfe', 'kind' => 'pc', 'default_owner_user_id' => (string) $bob]);
        $t2 = $this->newToken($gm, $game, ['name' => 'Nain', 'kind' => 'pc', 'default_owner_user_id' => (string) $bob]);
        $this->newToken($gm, $game, ['name' => 'Gobelin']);
        $before = $this->head();

        $s = self::data($this->ok($gm->post('/games/' . $game . '/sessions'), 201));

        self::assertEqualsCanonicalizing(
            [['token_id' => $t1['id'], 'user_id' => (string) $bob], ['token_id' => $t2['id'], 'user_id' => (string) $bob]],
            $s['assignments'],
        );
        self::assertSame(['assignment.set/all', 'assignment.set/all', 'session.state/all'], $this->kinds($before));
        self::assertSame([], $s['players'], 'pre-assigned players are not in the session until they join');
    }

    public function testListAndPagination(): void
    {
        $w = $this->arena();
        $path = '/games/' . $w['game'] . '/sessions';
        $first = $w['session'];
        $this->ok($w['gm']->post('/sessions/' . $first . '/end'));
        $second = self::data($this->ok($w['gm']->post($path), 201))['id'];
        $this->ok($w['gm']->post('/sessions/' . $second . '/end'));
        $third = self::data($this->ok($w['gm']->post($path), 201))['id'];

        $all = $this->ok($w['gm']->get($path));
        self::assertSame([$third, $second, $first], array_column(self::data($all), 'id'), 'recent first');
        self::assertArrayHasKey('code', self::data($all)[0]);

        $page = $this->ok($w['gm']->get($path . '?limit=2'));
        self::assertSame([$third, $second], array_column(self::data($page), 'id'));
        self::assertSame($second, $page->payload()['meta']['next_cursor']);
        $next = $this->ok($w['gm']->get($path . '?limit=2&cursor=' . $second));
        self::assertSame([$first], array_column(self::data($next), 'id'));
        self::assertArrayNotHasKey('next_cursor', (array) $next->payload()['meta']);

        // A co-GM sees everything; Bob only the session he figures in (the first one).
        self::assertCount(3, self::data($this->ok($w['co']->get($path))));
        $bobList = self::data($this->ok($w['bob']->get($path)));
        self::assertSame([$first], array_column($bobList, 'id'));
        self::assertArrayNotHasKey('code', $bobList[0]);
        self::assertSame('player', $bobList[0]['role']);
        // Kim was kicked, Dan never joined: nothing. Eve is not a member.
        self::assertSame([], self::data($this->ok($w['kim']->get($path))));
        self::assertSame([], self::data($this->ok($w['dan']->get($path))));
        self::assertSame(404, $w['eve']->get($path)->status());
        self::assertSame(401, $w['anon']->get($path)->status());
        self::assertFieldErrors($w['gm']->get($path . '?limit=0'), ['limit' => 'invalid']);
        self::assertFieldErrors($w['gm']->get($path . '?cursor=x'), ['cursor' => 'invalid']);
    }

    public function testShowGmAndPlayerViews(): void
    {
        $w = $this->arena();
        $gm = self::data($this->ok($w['gm']->get('/sessions/' . $w['session'])));
        self::assertSame($w['code'], $gm['code']);
        self::assertSame('gm', $gm['role']);
        self::assertSame(
            [['user_id' => (string) $this->userId('Bob'), 'username' => 'Bob', 'status' => 'connected', 'ready' => false],
             ['user_id' => (string) $this->userId('Kim'), 'username' => 'Kim', 'status' => 'kicked', 'ready' => false]],
            $gm['players'],
        );
        $bob = self::data($this->ok($w['bob']->get('/sessions/' . $w['session'])));
        self::assertArrayNotHasKey('code', $bob);
        self::assertSame('player', $bob['role']);
        self::assertSame(['Bob'], array_column($bob['players'], 'username'), 'a player does not see the kicked ones');
        self::assertSame($this->head(), (int) $bob['last_event_id']);
        self::assertStringNotContainsString($w['code'], json_encode($bob));
    }

    public function testPatchNameAndPauseScreen(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'];
        $before = $this->head();
        $s = self::data($this->ok($w['gm']->patch($path, ['name' => 'Renommée'])));
        self::assertSame('Renommée', $s['name']);
        self::assertSame([], $this->kinds($before), 'a rename is not an event');

        $s = self::data($this->ok($w['gm']->patch($path, ['pause_screen' => ['text' => "Pause\nCafé"]])));
        self::assertSame(['asset_id' => null, 'text' => "Pause\nCafé", 'url' => null], $s['pause_screen']);
        self::assertSame('Renommée', $s['name']);
        self::assertSame(['session.state/all'], $this->kinds($before));
        self::assertEquals(['asset_id' => null, 'text' => "Pause\nCafé"], $this->events($before)[0]['payload']['pause_screen']);

        $asset = $this->uploadOk($w['gm'], 'valid_png_opaque.png', ['kind' => 'background']);
        $s = self::data($this->ok($w['gm']->patch($path, ['pause_screen' => ['asset_id' => $asset['id'], 'text' => null]])));
        self::assertSame(['asset_id', 'text', 'url'], array_keys($s['pause_screen']));
        self::assertSame([$asset['id'], null], [$s['pause_screen']['asset_id'], $s['pause_screen']['text']]);
        self::assertStringContainsString('/files/' . $asset['uuid'], (string) $s['pause_screen']['url'], 'P7b D11: signed URL');

        self::assertFieldErrors($w['gm']->patch($path, ['pause_screen' => ['asset_id' => '9999']]), ['pause_screen.asset_id' => 'not_found']);
        self::assertFieldErrors($w['gm']->patch($path, ['pause_screen' => ['text' => str_repeat('x', 2001)]]), ['pause_screen.text' => 'too_long']);
        self::assertFieldErrors($w['gm']->patch($path, ['pause_screen' => ['foo' => 1]]), ['pause_screen' => 'invalid']);
        self::assertFieldErrors($w['gm']->patch($path, ['name' => str_repeat('x', 121)]), ['name' => 'too_long']);
        // Another GM's asset cannot be used.
        $bobAsset = $this->uploadOk($w['bob'], 'valid_png_opaque.png', ['kind' => 'background']);
        self::assertFieldErrors($w['gm']->patch($path, ['pause_screen' => ['asset_id' => $bobAsset['id']]]), ['pause_screen.asset_id' => 'not_found']);

        $s = self::data($this->ok($w['gm']->patch($path, ['pause_screen' => null, 'name' => ''])));
        self::assertNull($s['pause_screen']);
        self::assertNull($s['name']);
    }

    public function testTransitions(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $base = '/sessions/' . $w['session'];
        $before = $this->head();

        $s = self::data($this->ok($gm->post($base . '/start')));
        self::assertSame('running', $s['state']);
        self::assertNotNull($s['started_at']);
        $startedAt = $s['started_at'];
        self::assertSame(['session.state/all'], $this->kinds($before));
        self::assertSame('running', $this->events($before)[0]['payload']['state']);

        self::assertSame('paused', self::data($this->ok($gm->post($base . '/pause')))['state']);
        $resumed = self::data($this->ok($gm->post($base . '/resume')));
        self::assertSame('running', $resumed['state']);
        self::assertSame($startedAt, $resumed['started_at'], 'resume keeps started_at');
        self::assertSame('paused', self::data($this->ok($gm->post($base . '/pause')))['state']);
        $ended = self::data($this->ok($gm->post($base . '/end')));
        self::assertSame('ended', $ended['state']);
        self::assertNotNull($ended['ended_at']);
        self::assertSame(5, count($this->kinds($before)));
    }

    public function testInvalidTransitions(): void
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $base = '/sessions/' . $w['session'];
        $matrix = [
            'lobby' => ['pause', 'resume'],
            'running' => ['start', 'resume'],
            'paused' => ['start', 'pause'],
            'ended' => ['start', 'pause', 'resume', 'end'],
        ];
        foreach ($matrix as $state => $actions) {
            $this->setState($w['session'], $state);
            foreach ($actions as $action) {
                $before = $this->head();
                $response = $gm->post($base . '/' . $action);
                self::assertSame(409, $response->status(), $state . ' -> ' . $action);
                self::assertSame('invalid_transition', self::errorCode($response));
                self::assertSame($state, $this->state($w['session']), 'unchanged');
                self::assertSame($before, $this->head(), 'no event');
            }
        }
        foreach (['lobby', 'running', 'paused'] as $state) {
            $this->setState($w['session'], $state);
            self::assertSame('ended', self::data($this->ok($gm->post($base . '/end')))['state'], $state . ' -> end');
        }
    }

    public function testStartNeedsAMap(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $s = self::data($this->ok($gm->post('/games/' . $game . '/sessions'), 201));
        self::assertFieldErrors($gm->post('/sessions/' . $s['id'] . '/start'), ['current_map_id' => 'required']);
        self::assertSame('lobby', $this->state($s['id']));

        $map = $this->newMap($gm, $game);
        $this->ok($gm->post('/sessions/' . $s['id'] . '/change-map', ['map_id' => $map['id']]));
        $this->ok($gm->delete('/maps/' . $map['id']), 204);
        self::assertFieldErrors($gm->post('/sessions/' . $s['id'] . '/start'), ['current_map_id' => 'not_found']);
    }

    public function testCoGmCanDriveTheSession(): void
    {
        $w = $this->arena();
        $this->ok($w['co']->post('/sessions/' . $w['session'] . '/start'));
        $this->ok($w['co']->post('/sessions/' . $w['session'] . '/pause'));
        self::assertSame('paused', $this->state($w['session']));
        $this->ok($w['co']->post('/games/' . $w['game'] . '/sessions'), 409);
    }

    public function testRegenerateCode(): void
    {
        $w = $this->arena();
        $before = $this->head();
        $new = self::data($this->ok($w['gm']->post('/sessions/' . $w['session'] . '/regenerate-code')))['code'];
        self::assertNotSame($w['code'], $new);
        self::assertMatchesRegularExpression('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', $new);
        self::assertSame($new, self::data($this->ok($w['gm']->get('/sessions/' . $w['session'])))['code']);
        self::assertSame(['session.code/gm'], $this->kinds($before));
        self::assertSame(['code' => $new], $this->events($before)[0]['payload']);

        // The old code no longer joins; the new one does (and typed with a dash, lower case).
        $response = $w['dan']->post('/sessions/join', ['code' => $w['code']]);
        self::assertSame(422, $response->status());
        self::assertSame('session_code_invalid', self::errorCode($response));
        $typed = strtolower(substr($new, 0, 4) . '-' . substr($new, 4));
        $this->ok($w['dan']->post('/sessions/join', ['code' => $typed]));

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame(409, $w['gm']->post('/sessions/' . $w['session'] . '/regenerate-code')->status());
    }

    public function testChangeMapResetsReadyAndWritesMapChanged(): void
    {
        $w = $this->arena();
        $other = $this->newMap($w['gm'], $w['game'], ['name' => 'Donjon']);
        $this->ok($w['bob']->post('/sessions/' . $w['session'] . '/ready', ['ready' => true]), 204);
        self::assertTrue($this->isReady($w['session'], 'Bob'));
        $before = $this->head();

        $s = self::data($this->ok($w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $other['id'], 'floor_id' => $other['floors'][0]['id']])));

        self::assertSame((string) $other['id'], $s['current_map_id']);
        self::assertSame((string) $other['floors'][0]['id'], $s['current_floor_id']);
        self::assertFalse($this->isReady($w['session'], 'Bob'));
        self::assertSame(['map.changed/all'], $this->kinds($before));
        self::assertEquals(
            ['map_id' => (string) $other['id'], 'floor_id' => (string) $other['floors'][0]['id']],
            $this->events($before)[0]['payload'],
        );
        self::assertFieldErrors($w['gm']->post('/sessions/' . $w['session'] . '/change-map', []), ['map_id' => 'required']);
        self::assertFieldErrors($w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => '99999']), ['map_id' => 'not_found']);
        self::assertFieldErrors($w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['map'], 'floor_id' => '99999']), ['floor_id' => 'not_found']);

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame(409, $w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['map']])->status());
    }

    public function testClientOpIdReplaysTheSameResponse(): void
    {
        $w = $this->arena();
        $base = '/sessions/' . $w['session'];
        $first = $this->ok($w['gm']->post($base . '/start', ['client_op_id' => 'op-start-1']));
        $before = $this->head();
        $replay = $this->ok($w['gm']->post($base . '/start', ['client_op_id' => 'op-start-1']));
        self::assertSame(self::data($first)['state'], self::data($replay)['state']);
        self::assertSame(self::data($first)['started_at'], self::data($replay)['started_at']);
        self::assertSame($before, $this->head(), 'the replay runs nothing');

        // Without client_op_id the same request is refused (already running).
        self::assertSame(409, $w['gm']->post($base . '/start')->status());
        // Another operation, another user: refused.
        $response = $w['gm']->post($base . '/pause', ['client_op_id' => 'op-start-1']);
        self::assertFieldErrors($response, ['client_op_id' => 'already_used']);
        self::assertSame('running', $this->state($w['session']));
        $response = $w['co']->post($base . '/start', ['client_op_id' => 'op-start-1']);
        self::assertFieldErrors($response, ['client_op_id' => 'already_used']);

        // 204 operations and the others.
        $kick = ['user_id' => (string) $this->userId('Bob'), 'client_op_id' => 'op-kick'];
        $this->ok($w['gm']->post($base . '/kick', $kick), 204);
        $before = $this->head();
        $this->ok($w['gm']->post($base . '/kick', $kick), 204);
        self::assertSame($before, $this->head());
        $code = self::data($this->ok($w['gm']->post($base . '/regenerate-code', ['client_op_id' => 'op-code'])))['code'];
        self::assertSame($code, self::data($this->ok($w['gm']->post($base . '/regenerate-code', ['client_op_id' => 'op-code'])))['code']);
        $created = $this->ok($w['gm']->post('/games/' . $w['game'] . '/sessions', ['client_op_id' => 'op-new']), 409);
        self::assertSame('session_exists', self::errorCode($created));
        self::assertFieldErrors($w['gm']->post($base . '/pause', ['client_op_id' => 'bad id with spaces']), ['client_op_id' => 'invalid']);
    }

    public function testEventsCarryTheClientOpId(): void
    {
        $w = $this->arena();
        $before = $this->head();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/start', ['client_op_id' => 'op-evt']));
        $events = $this->events($before);
        self::assertSame('op-evt', $events[0]['client_op_id']);
    }
}
