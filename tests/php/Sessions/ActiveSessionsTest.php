<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

/**
 * GET /me/sessions/active: open sessions of all the games of the user in one call, same view as
 * GET /games/{id}/sessions (GM sees the code, a player only the sessions joined, nothing for others).
 */
final class ActiveSessionsTest extends SessionsTestCase
{
    /**
     * @return list<array<string, mixed>>
     */
    private function active(\JDR\Tests\Api\ApiClient $c): array
    {
        return self::data($this->ok($c->get('/me/sessions/active')));
    }

    public function testRolesAndVisibility(): void
    {
        $w = $this->arena();
        $this->assertSame(401, $w['anon']->get('/me/sessions/active')->status());
        $this->assertSame([], $this->active($w['eve']));
        $this->assertSame([], $this->active($w['dan']), 'member who never joined');
        $this->assertSame([], $this->active($w['kim']), 'kicked');

        $gm = $this->active($w['gm']);
        $this->assertCount(1, $gm);
        $this->assertEquals($w['game'], $gm[0]['game']['id']);
        $this->assertSame('gm', $gm[0]['session']['role']);
        $this->assertArrayHasKey('code', $gm[0]['session']);
        $this->assertSame('gm', $this->active($w['co'])[0]['session']['role']);

        $bob = $this->active($w['bob']);
        $this->assertCount(1, $bob);
        $this->assertSame('player', $bob[0]['session']['role']);
        $this->assertArrayNotHasKey('code', $bob[0]['session']);
        $this->assertEquals($w['session'], $bob[0]['session']['id']);

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        $this->assertSame([], $this->active($w['gm']));
        $this->assertSame([], $this->active($w['bob']));
    }

    public function testQueryCountIsConstant(): void
    {
        $w = $this->arena();
        $this->active($w['gm']);
        $before = $this->db->queryCount();
        $this->active($w['gm']);
        $one = $this->db->queryCount() - $before;
        for ($i = 0; $i < 3; $i++) {
            $g = (string) $this->newGame($w['gm'])['id'];
            $this->ok($w['gm']->post('/games/' . $g . '/sessions', []), 201);
        }
        $this->assertCount(4, $this->active($w['gm']));
        $before = $this->db->queryCount();
        $this->active($w['gm']);
        $this->assertSame($one, $this->db->queryCount() - $before);
    }
}
