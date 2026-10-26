<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

/**
 * D11: GET /maps/{id}/chunks and /fog open to the players of a running session on that map,
 * filtered by fog_strict (32 x 32 blocks); everything else on maps stays GM / co-GM only.
 */
final class PlayerMapAccessTest extends SessionsTestCase
{
    /**
     * @return list<string> "cx:cy" of the chunks of a chunks response
     */
    private function blocks(string $body): array
    {
        $out = [];
        foreach (self::parseChunks($body) as $c) {
            $out[$c['cx'] . ':' . $c['cy']] = true;
        }

        return array_keys($out);
    }

    public function testPlayerReadsOnlyHisBlocks(): void
    {
        $w = $this->bigScene();
        $url = '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'];

        $bob = $this->ok($w['bob']->get($url));
        self::assertSame(['0:0'], $this->blocks($bob->body()), 'tile (3, 3) yes, tile (150, 150) no');
        self::assertSame('application/octet-stream', $bob->header('Content-Type'));
        self::assertNotNull($bob->header('X-Map-Revision'));
        // The GM gets both.
        self::assertEqualsCanonicalizing(['0:0', '4:4'], $this->blocks($this->ok($w['gm']->get($url))->body()));
        // Asking for a closed block explicitly gives nothing.
        self::assertSame('', $this->ok($w['bob']->get($url . '&cells=4:4'))->body());
        self::assertSame(['0:0'], $this->blocks($this->ok($w['bob']->get($url . '&cells=4:4,0:0'))->body()));

        $this->explore($w['big'], $w['bigFloor'], 4, 4);
        self::assertEqualsCanonicalizing(['0:0', '4:4'], $this->blocks($this->ok($w['bob']->get($url))->body()));
        // Same bytes as the GM's for the same block.
        self::assertSame(
            $this->ok($w['gm']->get($url . '&cells=4:4'))->body(),
            $this->ok($w['bob']->get($url . '&cells=4:4'))->body(),
        );
    }

    public function testWithoutFogStrictEverythingOfTheMap(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->patch('/games/' . $w['game'], ['settings' => ['fog_strict' => false]]));
        $body = $this->ok($w['bob']->get('/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor']))->body();
        self::assertEqualsCanonicalizing(['0:0', '4:4'], $this->blocks($body));
    }

    public function testBlocksFollowTheTokensOfThePlayer(): void
    {
        $w = $this->bigScene();
        $url = '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'];
        // Moving the elf next to the far tile (the placed token op) opens block (4, 4) to Bob.
        $revision = $this->revision($w['big']);
        $this->ok($this->sendOps($w['gm'], $w['big'], [['type' => 'maptoken.update', 'uid' => 't-elf', 'rev' => 1, 'patch' => ['x' => 150, 'y' => 150]]], $revision));
        self::assertSame(['4:4'], $this->blocks($this->ok($w['bob']->get($url))->body()), 'the elf left block (0, 0)');
        // Dan's dwarf did not move.
        self::assertSame(['0:0'], $this->blocks($this->ok($w['dan']->get($url))->body()));
    }

    public function testFogEndpoint(): void
    {
        $w = $this->bigScene();
        $this->explore($w['big'], $w['bigFloor'], 3, 2);
        $data = self::data($this->ok($w['bob']->get('/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'])));
        self::assertSame($w['bigFloor'], $data['floor']);
        self::assertSame([[3, 2]], array_map(static fn (array $c): array => [$c[0], $c[1]], $data['chunks']));
        self::assertSame(
            self::data($this->ok($w['gm']->get('/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor']))),
            $data,
        );
        $this->assertFieldErrors($w['bob']->get('/maps/' . $w['big'] . '/fog'), ['floor' => 'required']);
        $this->assertFieldErrors($w['bob']->get('/maps/' . $w['big'] . '/fog?floor=99999'), ['floor' => 'not_found']);
        // Reset of the fog stays a GM action.
        self::assertSame(403, $w['bob']->delete('/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'])->status());
    }

    public function testStatesAndMaps(): void
    {
        $w = $this->bigScene(false);
        $chunks = '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'];
        $fog = '/maps/' . $w['big'] . '/fog?floor=' . $w['bigFloor'];
        // Lobby: no map data for a player (D11: running only).
        self::assertSame(403, $w['bob']->get($chunks)->status());
        self::assertSame(403, $w['bob']->get($fog)->status());

        $this->startSession($w);
        $this->ok($w['bob']->get($chunks));
        $this->ok($w['bob']->get($fog));

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        foreach ([$chunks, $fog] as $url) {
            $response = $w['bob']->get($url);
            self::assertSame(409, $response->status(), $url);
            self::assertSame('session_paused', self::errorCode($response));
            $this->ok($w['gm']->get($url));
        }

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/resume'));
        // Another map of the game: not the current one.
        self::assertSame(403, $w['bob']->get('/maps/' . $w['map'] . '/chunks')->status());
        self::assertSame(403, $w['bob']->get('/maps/' . $w['map'] . '/fog?floor=' . $w['floor'])->status());

        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end'));
        self::assertSame(403, $w['bob']->get($chunks)->status());
    }

    public function testOthersAreRefused(): void
    {
        $w = $this->bigScene();
        $chunks = '/maps/' . $w['big'] . '/chunks?floor=' . $w['bigFloor'];
        self::assertSame(403, $w['kim']->get($chunks)->status(), 'kicked');
        self::assertSame(404, $w['eve']->get($chunks)->status(), 'not a member');
        self::assertSame(401, $w['anon']->get($chunks)->status());
        $this->addMember($w['gm'], $w['game'], 'Zed');
        self::assertSame(403, $this->loginAs('Zed')->get($chunks)->status(), 'member outside the session');
        self::assertSame(200, $w['co']->get($chunks)->status());
    }

    public function testEveryOtherMapEndpointStaysGmOnly(): void
    {
        $w = $this->bigScene();
        $map = '/maps/' . $w['big'];
        $bob = $w['bob'];
        $ops = ['base_revision' => 1, 'client_op_id' => 'x-1', 'ops' => []];
        foreach ([
            ['GET', $map], ['PATCH', $map], ['DELETE', $map], ['POST', $map . '/duplicate'], ['POST', $map . '/ops', $ops],
            ['GET', $map . '/objects?floor=' . $w['bigFloor']], ['DELETE', $map . '/fog?floor=' . $w['bigFloor']],
            ['GET', $map . '/versions'], ['GET', $map . '/export'], ['GET', '/games/' . $w['game'] . '/maps'],
        ] as $call) {
            $response = $bob->request($call[0], $call[1], $call[2] ?? null);
            self::assertSame(403, $response->status(), $call[0] . ' ' . $call[1] . ': ' . $response->body());
        }
    }
}
