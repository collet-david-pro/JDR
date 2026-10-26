<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Tests\Api\ApiClient;

/**
 * Rights matrix (projet.md 11.2, contract P6 "Droits"): every session endpoint x gm, co-GM,
 * player, kicked player, member outside the session, non-member, anonymous. A refused request
 * changes nothing and writes no event. "ok" = authorized (neither 401, 403 nor 404: the outcome of an
 * authorized call depends on the state, e.g. 409 invalid_transition; successes are checked in the
 * other tests).
 */
final class SessionRightsMatrixTest extends SessionsTestCase
{
    private const OK = 'ok';

    /** Users in the order of the calls: the refused ones first (the allowed ones change the state). */
    private const ORDER = ['anon', 'eve', 'dan', 'kim', 'bob', 'co', 'gm'];

    /**
     * @return array<string, array{0: string, 1: string, 2: array<string, mixed>, 3: array<string, int|string>}>
     */
    public static function endpoints(): array
    {
        $gmOnly = ['anon' => 401, 'eve' => 404, 'dan' => 403, 'kim' => 403, 'bob' => 403, 'co' => self::OK, 'gm' => self::OK];
        $participants = ['anon' => 401, 'eve' => 404, 'dan' => 403, 'kim' => 403, 'bob' => self::OK, 'co' => self::OK, 'gm' => self::OK];
        $players = ['anon' => 401, 'eve' => 404, 'dan' => 403, 'kim' => 403, 'bob' => self::OK, 'co' => 403, 'gm' => 403];

        return [
            'show' => ['GET', '/sessions/{s}', [], $participants],
            'snapshot' => ['GET', '/sessions/{s}/snapshot', [], $participants],
            'preload' => ['GET', '/sessions/{s}/preload', [], $participants],
            'presence' => ['POST', '/presence', ['session_id' => '{s}'], $participants],
            'patch' => ['PATCH', '/sessions/{s}', ['name' => 'Nouveau'], $gmOnly],
            'start' => ['POST', '/sessions/{s}/start', [], $gmOnly],
            'pause' => ['POST', '/sessions/{s}/pause', [], $gmOnly],
            'resume' => ['POST', '/sessions/{s}/resume', [], $gmOnly],
            'end' => ['POST', '/sessions/{s}/end', [], $gmOnly],
            'regenerate' => ['POST', '/sessions/{s}/regenerate-code', [], $gmOnly],
            'kick' => ['POST', '/sessions/{s}/kick', ['user_id' => '{dan}'], $gmOnly],
            'assign' => ['PUT', '/sessions/{s}/assignments/{t}', ['user_id' => null], $gmOnly],
            'change-map' => ['POST', '/sessions/{s}/change-map', ['map_id' => '{map}'], $gmOnly],
            'ready' => ['POST', '/sessions/{s}/ready', ['ready' => true], $players],
            'leave' => ['POST', '/sessions/{s}/leave', [], $players],
            'create' => ['POST', '/games/{g}/sessions', [], ['anon' => 401, 'eve' => 404, 'dan' => 403, 'kim' => 403, 'bob' => 403, 'co' => self::OK, 'gm' => self::OK]],
            'list' => ['GET', '/games/{g}/sessions', [], ['anon' => 401, 'eve' => 404, 'dan' => self::OK, 'kim' => self::OK, 'bob' => self::OK, 'co' => self::OK, 'gm' => self::OK]],
        ];
    }

    /**
     * @dataProvider endpoints
     * @param array<string, mixed>          $body
     * @param array<string, int|string>     $expected user => status | "ok"
     */
    public function testEndpoint(string $method, string $path, array $body, array $expected): void
    {
        $w = $this->arena();
        $token = $this->newToken($w['gm'], $w['game'], ['name' => 'Elfe', 'kind' => 'pc']);
        $ids = [
            '{s}' => $w['session'], '{g}' => $w['game'], '{t}' => (string) $token['id'], '{map}' => $w['map'],
            '{dan}' => (string) $this->userId('Dan'),
        ];
        $path = strtr($path, $ids);
        $body = array_map(static fn (mixed $v): mixed => is_string($v) ? strtr($v, $ids) : $v, $body);
        $head = $this->head();
        $players = $this->rows('session_players');

        foreach (self::ORDER as $who) {
            /** @var ApiClient $client */
            $client = $w[$who];
            $response = $method === 'GET' ? $client->get($path) : $client->request($method, $path, $body);
            $want = $expected[$who];
            if ($want === self::OK) {
                self::assertNotContains($response->status(), [401, 403, 404], $method . ' ' . $path . ' by ' . $who . ': ' . $response->body());
                self::assertLessThan(500, $response->status(), $response->body());
            } else {
                self::assertSame($want, $response->status(), $method . ' ' . $path . ' by ' . $who . ': ' . $response->body());
            }
            if ($want !== self::OK) {
                self::assertSame($head, $this->head(), 'a refused call writes no event (' . $who . ')');
                self::assertSame($players, $this->rows('session_players'), 'a refused call changes no player (' . $who . ')');
            } else {
                $head = $this->head();
                $players = $this->rows('session_players');
            }
        }
    }

    public function testGmEndpointsRefusePlayersWithoutSideEffect(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'];
        foreach (['bob', 'dan', 'kim', 'eve'] as $who) {
            foreach (['start', 'pause', 'resume', 'end', 'regenerate-code'] as $action) {
                $response = $w[$who]->post($path . '/' . $action);
                self::assertContains($response->status(), [403, 404], $who . ' ' . $action);
            }
        }
        self::assertSame('lobby', $this->state($w['session']));
        self::assertSame($w['code'], (string) $this->db->fetchValue('SELECT `code` FROM ' . $this->db->t('play_sessions')));
    }

    public function testTrashedGameHidesItsSessions(): void
    {
        $w = $this->arena();
        $this->ok($w['gm']->delete('/games/' . $w['game']), 204);
        foreach (['gm', 'co', 'bob'] as $who) {
            self::assertSame(404, $w[$who]->get('/sessions/' . $w['session'])->status(), $who);
        }
        self::assertSame(422, $w['dan']->post('/sessions/join', ['code' => $w['code']])->status());
    }
}
