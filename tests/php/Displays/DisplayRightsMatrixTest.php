<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

use JDR\Tests\Api\ApiClient;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Rights matrix: every GM endpoint x {Alice, Carl, Bob, Dan, Eve, anonymous, screen}; every screen
 * endpoint x {screen, revoked screen, anonymous, Alice without a screen cookie}.
 */
final class DisplayRightsMatrixTest extends DisplaysTestCase
{
    /**
     * @return array<string, array{0: string, 1: int}> endpoint => expected status for the GM
     */
    public static function gmEndpoints(): array
    {
        return [
            'create' => ['create', 201],
            'list' => ['list', 200],
            'patch' => ['patch', 200],
            'delete' => ['delete', 204],
            'regenerate' => ['regenerate', 200],
        ];
    }

    /**
     * @return array<string, array{0: string, 1: int}> actor => status for a non-GM
     */
    public static function actors(): array
    {
        return [
            'gm' => ['gm', 0],
            'co' => ['co', 0],
            'bob' => ['bob', 403],
            'dan' => ['dan', 403],
            'eve' => ['eve', 404],
            'anon' => ['anon', 401],
            'screen' => ['screen', 401],
        ];
    }

    /**
     * @return iterable<string, array{0: string, 1: int, 2: string, 3: int}>
     */
    public static function gmMatrix(): iterable
    {
        foreach (self::gmEndpoints() as $endpointName => [$endpoint, $ok]) {
            foreach (self::actors() as $actorName => [$actor, $status]) {
                yield $endpointName . ' x ' . $actorName => [$endpoint, $ok, $actor, $status === 0 ? $ok : $status];
            }
        }
    }

    #[DataProvider('gmMatrix')]
    public function testGmEndpoints(string $endpoint, int $gmStatus, string $actor, int $expected): void
    {
        $w = $this->arena();
        $w['anon']->get('/auth/me');
        [$screen] = $this->pairedScreen($w['gm'], $w['session'], 'Paired');
        $w['screen'] = $screen;
        $pending = $this->makeDisplay($w['gm'], $w['session'], 'Pending');
        $id = $pending['id'];
        $s = $w['session'];
        $client = $w[$actor];
        /** @var ApiClient $client */
        $r = match ($endpoint) {
            'create' => $client->post('/sessions/' . $s . '/displays', ['name' => 'N']),
            'list' => $client->get('/sessions/' . $s . '/displays'),
            'patch' => $client->patch('/displays/' . $id, ['name' => 'Renamed']),
            'delete' => $client->delete('/displays/' . $id),
            'regenerate' => $client->post('/displays/' . $id . '/regenerate-code'),
        };
        self::assertSame($expected, $r->status(), $endpoint . ' / ' . $actor . ' ' . $r->body());
        if ($expected !== $gmStatus) {
            // Refused: nothing changed.
            self::assertSame('Pending', $this->displayRow($id)['name'] ?? 'Pending');
            self::assertSame(2, $this->rows('session_displays'));
        }
    }

    public function testDisplayOfAnotherSessionFollowsTheRightsOfItsOwnSession(): void
    {
        $w = $this->arena();
        $game2 = (string) $this->newGame($w['gm'], 'Autre')['id'];
        $map2 = $this->newMap($w['gm'], $game2);
        $s2 = self::data($this->ok($w['gm']->post('/games/' . $game2 . '/sessions', ['map_id' => $map2['id']]), 201));
        $other = $this->makeDisplay($w['gm'], (string) $s2['id']);
        foreach (['co', 'bob', 'dan', 'eve'] as $who) {
            // Carl and Bob belong to game 1 only: nothing of game 2.
            self::assertSame(404, $w[$who]->patch('/displays/' . $other['id'], ['name' => 'x'])->status(), $who);
            self::assertSame(404, $w[$who]->delete('/displays/' . $other['id'])->status(), $who);
        }
        self::assertSame(1, $this->rows('session_displays'));
    }

    /**
     * @return iterable<string, array{0: string, 1: string}>
     */
    public static function deviceMatrix(): iterable
    {
        foreach (['me', 'patch', 'unpair'] as $endpoint) {
            foreach (['screen', 'revoked', 'anon', 'alice'] as $actor) {
                yield $endpoint . ' x ' . $actor => [$endpoint, $actor];
            }
        }
    }

    #[DataProvider('deviceMatrix')]
    public function testDeviceEndpoints(string $endpoint, string $actor): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $client = match ($actor) {
            'screen' => $screen,
            'revoked' => $screen,
            'anon' => $this->screen(),
            'alice' => $w['gm'],
        };
        if ($actor === 'revoked') {
            $this->ok($w['gm']->delete('/displays/' . $d['id']), 204);
        }
        $r = match ($endpoint) {
            'me' => $client->get('/display/me?as=display'),
            'patch' => $client->patch('/display/me?as=display', ['settings' => ['mirror' => true]]),
            'unpair' => $client->post('/display/unpair?as=display'),
        };
        if ($actor === 'screen') {
            self::assertSame($endpoint === 'unpair' ? 204 : 200, $r->status(), $r->body());

            return;
        }
        self::assertSame(401, $r->status(), $r->body());
        self::assertSame('display_unpaired', self::errorCode($r));
    }

    public function testPairingDoesNotDependOnTheLoggedInUser(): void
    {
        $w = $this->arena();
        $d = $this->makeDisplay($w['gm'], $w['session']);
        $r = $w['bob']->post('/display/pair', ['code' => $d['pairing']['code']]);
        self::assertSame(200, $r->status(), $r->body());
        self::assertSame(403, $w['bob']->post('/sessions/' . $w['session'] . '/displays', ['name' => 'x'])->status(), 'still a mere player');
    }
}
