<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

/**
 * Join, leave, kick, ready and assignments (P6b).
 */
final class SessionPlayersTest extends SessionsTestCase
{
    public function testJoinCreatesMemberAndPlayerAndEvent(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $s = self::data($this->ok($gm->post('/games/' . $game . '/sessions'), 201));
        $this->createUser('Eve');
        $eve = $this->loginAs('Eve');
        $eveId = $this->userId('Eve');
        self::assertSame(0, $this->rows('game_members', '`user_id` = ?', [$eveId]));
        $before = $this->head();

        $response = $this->ok($eve->post('/sessions/join', ['code' => $s['code']]));

        self::assertSame(['session_id' => $s['id'], 'game_id' => $game], self::data($response));
        self::assertSame(1, $this->rows('game_members', '`game_id` = ? AND `user_id` = ? AND `role` = ?', [(int) $game, $eveId, 'player']));
        self::assertSame('connected', $this->playerStatus($s['id'], 'Eve'));
        self::assertSame(['player.joined/players'], $this->kinds($before));
        self::assertEquals(['user_id' => (string) $eveId, 'username' => 'Eve'], $this->events($before)[0]['payload']);
        self::assertSame($eveId, (int) $this->events($before)[0]['actor_user_id']);
        // Eve now sees the game and the session.
        $mine = self::data($this->ok($eve->get('/sessions/' . $s['id'])));
        self::assertSame('player', $mine['role']);
    }

    public function testJoinNormalizesTheCode(): void
    {
        $w = $this->arena();
        $this->ok($w['dan']->post('/sessions/join', ['code' => ' ' . strtolower(substr($w['code'], 0, 4)) . ' - ' . strtolower(substr($w['code'], 4)) . ' ']));
        self::assertSame('connected', $this->playerStatus($w['session'], 'Dan'));
    }

    public function testJoinCodeErrors(): void
    {
        $w = $this->arena();
        $eve = $w['eve'];
        foreach ([null, '', 'ABC', 'ABCDEFGH1', 'AAAAAAA0', 'IIIIOOOO', 'ZZZZZZZZ', 12345678, ['A']] as $code) {
            $response = $eve->post('/sessions/join', $code === null ? [] : ['code' => $code]);
            self::assertSame(422, $response->status(), json_encode($code));
            self::assertSame('session_code_invalid', self::errorCode($response));
        }
        self::assertSame(0, $this->rows('game_members', '`user_id` = ?', [$this->userId('Eve')]));
        self::assertSame(401, $w['anon']->post('/sessions/join', ['code' => $w['code']])->status());
    }

    public function testJoinEndedAndKicked(): void
    {
        $w = $this->arena();
        $response = $w['kim']->post('/sessions/join', ['code' => $w['code']]);
        self::assertSame(403, $response->status());
        self::assertSame('kicked', self::errorCode($response));
        self::assertSame('kicked', $this->playerStatus($w['session'], 'Kim'));

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        foreach (['eve', 'bob', 'kim'] as $who) {
            $response = $w[$who]->post('/sessions/join', ['code' => $w['code']]);
            self::assertSame(410, $response->status(), $who);
            self::assertSame('session_not_joinable', self::errorCode($response));
        }
        self::assertSame(0, $this->rows('game_members', '`user_id` = ?', [$this->userId('Eve')]));
    }

    public function testJoinByTheGmAndCoGmCreatesNothing(): void
    {
        $w = $this->arena();
        $before = $this->head();
        self::assertSame($w['session'], self::data($this->ok($w['gm']->post('/sessions/join', ['code' => $w['code']])))['session_id']);
        self::assertSame($w['session'], self::data($this->ok($w['co']->post('/sessions/join', ['code' => $w['code']])))['session_id']);
        self::assertSame(2, $this->rows('session_players', '`session_id` = ?', [(int) $w['session']]), 'Bob and Kim only');
        self::assertSame($before, $this->head());
    }

    public function testRejoinAfterLeaveAndTheLateComer(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'];
        $before = $this->head();
        $this->ok($w['bob']->post($path . '/leave'), 204);
        self::assertSame('disconnected', $this->playerStatus($w['session'], 'Bob'));
        self::assertSame(['player.left/players'], $this->kinds($before));
        $this->ok($w['bob']->post($path . '/leave'), 204);
        self::assertSame(['player.left/players'], $this->kinds($before), 'leaving twice is a no-op');

        $this->startSession($w);
        $before = $this->head();
        $this->ok($w['bob']->post('/sessions/join', ['code' => $w['code']]));
        self::assertSame('connected', $this->playerStatus($w['session'], 'Bob'));
        self::assertSame(['player.joined/players'], $this->kinds($before));
        // A connected player who joins again changes nothing.
        $this->ok($w['bob']->post('/sessions/join', ['code' => $w['code']]));
        self::assertSame(['player.joined/players'], $this->kinds($before));
        // A new player joins a running session.
        $this->ok($w['dan']->post('/sessions/join', ['code' => $w['code']]));
        self::assertSame(['player.joined/players', 'player.joined/players'], $this->kinds($before));
    }

    public function testJoinIsLimitedToTenPerMinutePerUser(): void
    {
        $w = $this->arena();
        // The arena already used one join of Bob.
        for ($i = 0; $i < 9; $i++) {
            $this->ok($w['bob']->post('/sessions/join', ['code' => $w['code']]));
        }
        $response = $w['bob']->post('/sessions/join', ['code' => $w['code']]);
        self::assertSame(429, $response->status());
        self::assertSame('rate_limited', self::errorCode($response));
        self::assertNotNull($response->header('Retry-After'));
        // Another user is not concerned.
        $this->ok($w['dan']->post('/sessions/join', ['code' => $w['code']]));
    }

    public function testKickRemovesAssignmentsAndWritesEvents(): void
    {
        $w = $this->arena(false);
        $t1 = $this->newToken($w['gm'], $w['game'], ['name' => 'Elfe', 'kind' => 'pc']);
        $t2 = $this->newToken($w['gm'], $w['game'], ['name' => 'Nain', 'kind' => 'pc']);
        $t3 = $this->newToken($w['gm'], $w['game'], ['name' => 'Orc', 'kind' => 'pc']);
        $path = '/sessions/' . $w['session'];
        foreach ([[$t1, 'Kim'], [$t2, 'Kim'], [$t3, 'Bob']] as [$token, $name]) {
            $this->ok($w['gm']->put($path . '/assignments/' . $token['id'], ['user_id' => (string) $this->userId($name)]));
        }
        $this->ok($w['kim']->post($path . '/ready', ['ready' => true]), 204);
        $before = $this->head();

        $this->ok($w['gm']->post($path . '/kick', ['user_id' => (string) $this->userId('Kim')]), 204);

        self::assertSame('kicked', $this->playerStatus($w['session'], 'Kim'));
        self::assertFalse($this->isReady($w['session'], 'Kim'));
        self::assertSame(1, $this->rows('token_assignments', '`session_id` = ?', [(int) $w['session']]), 'only Bob keeps his token');
        self::assertSame(
            ['player.kicked/user', 'assignment.set/all', 'assignment.set/all', 'player.left/players'],
            $this->kinds($before),
        );
        $events = $this->events($before);
        self::assertSame($this->userId('Kim'), (int) $events[0]['audience_user_id']);
        self::assertEquals(['reason' => null], $events[0]['payload']);
        self::assertEquals(['token_id' => $t1['id'], 'user_id' => null], $events[1]['payload']);
        self::assertEquals(['token_id' => $t2['id'], 'user_id' => null], $events[2]['payload']);
        self::assertEquals(['user_id' => (string) $this->userId('Kim'), 'username' => 'Kim'], $events[3]['payload']);

        // Kim is refused everywhere in the session now; kicking twice is a no-op.
        self::assertSame(403, $w['kim']->get($path)->status());
        $before = $this->head();
        $this->ok($w['gm']->post($path . '/kick', ['user_id' => (string) $this->userId('Kim')]), 204);
        self::assertSame($before, $this->head());
    }

    public function testKickErrors(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'] . '/kick';
        self::assertFieldErrors($w['gm']->post($path, []), ['user_id' => 'required']);
        self::assertFieldErrors($w['gm']->post($path, ['user_id' => 'x']), ['user_id' => 'invalid']);
        self::assertFieldErrors($w['gm']->post($path, ['user_id' => (string) $this->userId('Dan')]), ['user_id' => 'not_in_session']);
        self::assertFieldErrors($w['gm']->post($path, ['user_id' => (string) $this->userId('Carl')]), ['user_id' => 'not_in_session']);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame(409, $w['gm']->post($path, ['user_id' => (string) $this->userId('Bob')])->status());
    }

    public function testAssignments(): void
    {
        $w = $this->arena();
        $token = $this->newToken($w['gm'], $w['game'], ['name' => 'Elfe', 'kind' => 'pc']);
        $path = '/sessions/' . $w['session'] . '/assignments/' . $token['id'];
        $bob = (string) $this->userId('Bob');
        $before = $this->head();

        $r = $this->ok($w['gm']->put($path, ['user_id' => $bob]));
        self::assertSame(['token_id' => $token['id'], 'user_id' => $bob], self::data($r));
        self::assertSame(['assignment.set/all'], $this->kinds($before));
        self::assertEquals(['token_id' => $token['id'], 'user_id' => $bob], $this->events($before)[0]['payload']);
        self::assertSame([['token_id' => $token['id'], 'user_id' => $bob]], self::data($this->ok($w['bob']->get('/sessions/' . $w['session'])))['assignments']);

        // Same assignment: no new event. Reassign: one. Unassign: one.
        $this->ok($w['gm']->put($path, ['user_id' => $bob]));
        self::assertSame(['assignment.set/all'], $this->kinds($before));
        $this->ok($w['co']->put($path, ['user_id' => null]));
        self::assertSame(['assignment.set/all', 'assignment.set/all'], $this->kinds($before));
        self::assertNull($this->events($before)[1]['payload']['user_id']);
        self::assertSame(0, $this->rows('token_assignments'));
        $this->ok($w['gm']->put($path, ['user_id' => null]));
        self::assertSame(2, count($this->kinds($before)));

        self::assertFieldErrors($w['gm']->put($path, []), ['user_id' => 'required']);
        self::assertFieldErrors($w['gm']->put($path, ['user_id' => 'zz']), ['user_id' => 'invalid']);
        self::assertFieldErrors($w['gm']->put($path, ['user_id' => (string) $this->userId('Kim')]), ['user_id' => 'not_in_session']);
        self::assertFieldErrors($w['gm']->put($path, ['user_id' => (string) $this->userId('Dan')]), ['user_id' => 'not_in_session']);
        self::assertFieldErrors($w['gm']->put($path, ['user_id' => (string) $this->userId('Alice')]), ['user_id' => 'not_in_session']);
        self::assertSame(404, $w['gm']->put('/sessions/' . $w['session'] . '/assignments/99999', ['user_id' => $bob])->status());
        // A token of another game, or in the trash.
        $other = (string) $this->newGame($w['gm'], 'Autre')['id'];
        $foreign = $this->newToken($w['gm'], $other, ['name' => 'Etranger']);
        self::assertSame(404, $w['gm']->put('/sessions/' . $w['session'] . '/assignments/' . $foreign['id'], ['user_id' => $bob])->status());
        $trash = $this->newToken($w['gm'], $w['game'], ['name' => 'Corbeille']);
        $this->ok($w['gm']->delete('/tokens/' . $trash['id']), 204);
        self::assertSame(404, $w['gm']->put('/sessions/' . $w['session'] . '/assignments/' . $trash['id'], ['user_id' => $bob])->status());
        self::assertSame(0, $this->rows('token_assignments'));

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame(409, $w['gm']->put($path, ['user_id' => $bob])->status());
    }

    public function testReady(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'] . '/ready';
        $before = $this->head();
        $this->ok($w['bob']->post($path, ['ready' => true]), 204);
        self::assertTrue($this->isReady($w['session'], 'Bob'));
        self::assertSame(['player.ready/players'], $this->kinds($before));
        self::assertEquals(['user_id' => (string) $this->userId('Bob'), 'ready' => true], $this->events($before)[0]['payload']);
        $this->ok($w['bob']->post($path, ['ready' => true]), 204);
        self::assertSame(1, count($this->kinds($before)), 'unchanged => no event');
        $this->ok($w['bob']->post($path, ['ready' => false]), 204);
        self::assertFalse($this->isReady($w['session'], 'Bob'));
        self::assertSame(2, count($this->kinds($before)));

        self::assertFieldErrors($w['bob']->post($path, []), ['ready' => 'required']);
        self::assertFieldErrors($w['bob']->post($path, ['ready' => 'yes']), ['ready' => 'invalid']);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame(409, $w['bob']->post($path, ['ready' => true])->status());
    }

    public function testReadyAndLeaveBelongToPlayersOnly(): void
    {
        $w = $this->arena();
        foreach (['gm', 'co'] as $who) {
            self::assertSame(403, $w[$who]->post('/sessions/' . $w['session'] . '/ready', ['ready' => true])->status(), $who);
            self::assertSame(403, $w[$who]->post('/sessions/' . $w['session'] . '/leave')->status(), $who);
        }
    }
}
