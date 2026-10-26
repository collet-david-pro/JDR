<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * token.move (contract P6 "Actions de séance"): rights (GM, assigned player,
 * players_can_move_own_tokens), session states, validation, persistence (+ rev), events,
 * idempotence of client_op_id, last_event_id after COMMIT.
 */
final class TokenMoveTest extends ActionsTestCase
{
    public function testGmMovesAnyTokenAndTheMoveIsStored(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $rev = $this->placed($w['big'], 't-goblin')['rev'];
        $response = $this->ok($this->act($w['gm'], $w['session'], [self::move('t-goblin', 20.5, 7, 90)]));
        $data = self::data($response);

        self::assertSame([['index' => 0, 'ok' => true, 'uid' => 't-goblin', 'x' => 20.5, 'y' => 7, 'rotation' => 90]], $data['results']);
        self::assertSame((string) $this->head(), $data['last_event_id'], 'read after COMMIT: the last event of the batch');
        self::assertSame(['x' => 20.5, 'y' => 7.0, 'rotation' => 90, 'rev' => $rev + 1, 'hidden' => false], $this->placed($w['big'], 't-goblin'));
        $kinds = $this->kinds($head);
        self::assertSame('maptoken.moved/gm', $kinds[0]);
        $gm = $this->events($head)[0];
        self::assertEquals(['uid' => 't-goblin', 'x' => 20.5, 'y' => 7, 'rotation' => 90, 'floor' => $w['bigFloor'], 'view' => 'gm'], $gm['payload']);
        self::assertSame((string) $this->userId('Alice'), (string) $gm['actor_user_id']);
    }

    public function testPlayerMovesOnlyHisOwnTokens(): void
    {
        $w = $this->bigScene();
        $results = $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 6, 6)]);
        self::assertTrue($results[0]['ok']);
        self::assertSame(6.0, $this->placed($w['big'], 't-elf')['x']);

        foreach (['t-goblin', 't-dwarf', 't-dragon', 'nope'] as $uid) {
            $r = $this->act($w['bob'], $w['session'], [self::move($uid, 7, 7)]);
            self::assertSame(403, $r->status(), $uid);
        }
        // A batch with one forbidden action applies nothing.
        $r = $this->act($w['bob'], $w['session'], [self::move('t-elf', 7, 7), self::move('t-goblin', 7, 7)]);
        self::assertSame(403, $r->status());
        self::assertSame(6.0, $this->placed($w['big'], 't-elf')['x']);
        // Players may only move and explore.
        foreach ([['type' => 'note.show', 'title' => 'x', 'body' => ''], ['type' => 'door.toggle', 'uid' => 'door-plain']] as $a) {
            self::assertSame(403, $this->act($w['bob'], $w['session'], [$a])->status());
        }
    }

    public function testSettingPlayersCanMoveOwnTokens(): void
    {
        $w = $this->bigScene();
        $this->setSettings($w, ['players_can_move_own_tokens' => false]);
        self::assertSame(403, $this->act($w['bob'], $w['session'], [self::move('t-elf', 6, 6)])->status());
        self::assertTrue($this->actOk($w['gm'], $w['session'], [self::move('t-elf', 6, 6)])[0]['ok']);
    }

    public function testWhoMayAct(): void
    {
        $w = $this->bigScene();
        self::assertTrue($this->actOk($w['co'], $w['session'], [self::move('t-elf', 6, 6)])[0]['ok'], 'co-GM');
        self::assertSame(403, $this->act($w['kim'], $w['session'], [self::move('t-elf', 6, 6)])->status(), 'kicked');
        self::assertSame(403, $this->act($w['dan'], $w['session'], [self::move('t-elf', 6, 6)])->status(), 'not his token');
        self::assertSame(404, $this->act($w['eve'], $w['session'], [self::move('t-elf', 6, 6)])->status(), 'outsider');
        self::assertSame(401, $this->act($w['anon'], $w['session'], [self::move('t-elf', 6, 6)])->status());
        $this->ok($w['gm']->put('/sessions/' . $w['session'] . '/assignments/' . $w['dwarf']['id'], ['user_id' => null]));
        self::assertSame(403, $this->act($w['dan'], $w['session'], [self::move('t-dwarf', 6, 6)])->status(), 'no longer assigned');
    }

    public function testStates(): void
    {
        $w = $this->bigScene(false);
        $move = [self::move('t-elf', 6, 6)];
        self::assertSame('session_not_running', self::errorCode($this->act($w['bob'], $w['session'], $move)));
        self::assertSame('session_not_running', self::errorCode($this->act($w['gm'], $w['session'], $move)), 'GM: running or paused');
        $this->startSession($w);
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $r = $this->act($w['bob'], $w['session'], $move);
        self::assertSame(409, $r->status());
        self::assertSame('session_paused', self::errorCode($r));
        self::assertTrue($this->actOk($w['gm'], $w['session'], $move)[0]['ok'], 'the GM acts while paused');
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame('session_not_running', self::errorCode($this->act($w['bob'], $w['session'], $move)));
        self::assertSame('session_not_running', self::errorCode($this->act($w['gm'], $w['session'], $move)));
    }

    public function testValidationAppliesNothing(): void
    {
        $w = $this->bigScene();
        $cases = [
            [[], ['actions' => 'invalid']],
            [array_fill(0, 21, self::move('t-elf', 6, 6)), ['actions' => 'too_many']],
            [[['type' => 'token.jump']], ['actions.0.type' => 'invalid']],
            [[['uid' => 'x']], ['actions.0.type' => 'required']],
            [['oops'], ['actions.0' => 'invalid']],
            [[self::move('t-elf', 6, 6) + ['extra' => 1]], ['actions.0' => 'invalid']],
            [[['type' => 'token.move', 'uid' => 't-elf', 'x' => 6]], ['actions.0.y' => 'required']],
            [[self::move('t-elf', -1, 6)], ['actions.0.x' => 'too_small']],
            [[self::move('t-elf', 6, 6, 360)], ['actions.0.rotation' => 'too_large']],
            [[self::move('bad uid!', 6, 6)], ['actions.0.uid' => 'invalid']],
            [[self::move('t-elf', 201, 6)], ['actions.0.x' => 'too_large']],
            [[self::move('t-elf', 7, 7), self::move('missing', 6, 6)], ['actions.1.uid' => 'not_found']],
        ];
        foreach ($cases as $i => [$actions, $fields]) {
            $r = $this->act($w['gm'], $w['session'], $actions);
            self::assertSame(422, $r->status(), $i . ': ' . $r->body());
            self::assertSame($fields, $r->payload()['error']['fields'], (string) $i);
        }
        self::assertSame(5.0, $this->placed($w['big'], 't-elf')['x'], 'nothing applied');
        $r = $w['gm']->post('/sessions/' . $w['session'] . '/actions', ['client_op_id' => str_repeat('x', 41), 'actions' => [self::move('t-elf', 6, 6)]]);
        self::assertSame(['client_op_id' => 'invalid'], $r->payload()['error']['fields']);
    }

    public function testClientOpIdIsIdempotent(): void
    {
        $w = $this->bigScene();
        $first = self::data($this->ok($this->act($w['bob'], $w['session'], [self::move('t-elf', 6, 6)], 'move-1')));
        $head = $this->head();
        $again = self::data($this->ok($this->act($w['bob'], $w['session'], [self::move('t-elf', 9, 9)], 'move-1')));
        self::assertEquals($first['results'], $again['results']);
        self::assertSame(6.0, $this->placed($w['big'], 't-elf')['x'], 'not applied twice');
        self::assertSame($head, $this->head(), 'no new event');
        self::assertSame((string) $head, $again['last_event_id']);
        // Same id by another user: refused.
        $r = $this->act($w['gm'], $w['session'], [self::move('t-elf', 9, 9)], 'move-1');
        self::assertSame(['client_op_id' => 'already_used'], $r->payload()['error']['fields']);
    }

    public function testNoChangeWritesNoEvent(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $data = self::data($this->ok($this->act($w['gm'], $w['session'], [self::move('t-elf', 5, 5)])));
        self::assertTrue($data['results'][0]['ok']);
        self::assertSame($head, $this->head());
        self::assertSame((string) $head, $data['last_event_id']);
    }

    public function testMovesOfOneBatchAreAppliedInOrder(): void
    {
        $w = $this->bigScene();
        $results = $this->actOk($w['gm'], $w['session'], [self::move('t-goblin', 10, 10), self::move('t-goblin', 11, 12, 45)]);
        self::assertSame([0, 1], array_column($results, 'index'));
        self::assertSame(['x' => 11.0, 'y' => 12.0, 'rotation' => 45], array_intersect_key($this->placed($w['big'], 't-goblin'), ['x' => 1, 'y' => 1, 'rotation' => 1]));
    }
}
