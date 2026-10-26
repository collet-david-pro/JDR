<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * D8 through POST /sessions/{id}/actions: a player's token stops at the last valid point before a
 * wall, a closed or secret door, a window (stored and broadcast, result blocked_by_wall); open
 * doors let it pass; the GM and players_blocked_by_walls = false are not blocked.
 */
final class CollisionApiTest extends ActionsTestCase
{
    public function testPlayerStopsBeforeAWall(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $data = self::data($this->ok($this->act($w['bob'], $w['session'], [self::move('t-elf', 5, 0)])));
        self::assertSame([['index' => 0, 'ok' => false, 'error' => 'blocked_by_wall', 'position' => ['x' => 5, 'y' => 2.41]]], $data['results']);
        self::assertSame(['x' => 5.0, 'y' => 2.41], array_intersect_key($this->placed($w['big'], 't-elf'), ['x' => 1, 'y' => 1]));
        $moved = array_values(array_filter($this->events($head), static fn (array $e): bool => $e['type'] === 'maptoken.moved' && $e['audience'] === 'gm'));
        self::assertCount(1, $moved);
        self::assertEquals(2.41, $moved[0]['payload']['y'], 'the stored position is broadcast');
        // From there, moving away is free.
        self::assertTrue($this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 6)])[0]['ok']);
    }

    public function testGmAndSettingAreNotBlocked(): void
    {
        $w = $this->bigScene();
        self::assertTrue($this->actOk($w['gm'], $w['session'], [self::move('t-elf', 5, 0)])[0]['ok'], 'GM');
        $this->actOk($w['gm'], $w['session'], [self::move('t-elf', 5, 5)]);
        $this->setSettings($w, ['players_blocked_by_walls' => false]);
        self::assertSame(['x' => 5, 'y' => 0], array_intersect_key($this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5, 0)])[0], ['x' => 1, 'y' => 1]));
    }

    public function testDoorsAndWindows(): void
    {
        $w = $this->bigScene();
        $this->fill($w['gm'], $w['big'], [
            ['uid' => 'win', 'floor' => $w['bigFloor'], 'type' => 'window', 'layer' => 'walls', 'geometry' => ['a' => [16, 2], 'b' => [17, 2]],
                'props' => ['kind' => 'glass'], 'visibility' => 'all', 'locked' => false, 'sort_order' => 0],
        ]);
        $up = fn (float $x): array => $this->actOk($w['bob'], $w['session'], [self::move('t-elf', $x, 5), self::move('t-elf', $x, 0)])[1];

        // Secret door (hidden): a wall. Revealed but closed: still blocks. Opened: passes.
        self::assertSame('blocked_by_wall', $up(12.5)['error'] ?? null);
        $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 'door-secret']]);
        self::assertSame('blocked_by_wall', $up(12.5)['error'] ?? null);
        $this->actOk($w['gm'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-secret', 'state' => 'open']]);
        self::assertTrue($up(12.5)['ok']);
        // Plain door: closed blocks, open passes.
        self::assertSame('blocked_by_wall', $up(14.5)['error'] ?? null);
        $this->actOk($w['gm'], $w['session'], [['type' => 'door.toggle', 'uid' => 'door-plain']]);
        self::assertTrue($up(14.5)['ok']);
        // Window: always blocks the movement.
        $hit = $up(16.5);
        self::assertSame('blocked_by_wall', $hit['error'] ?? null);
        self::assertEquals(['x' => 16.5, 'y' => 2.41], $hit['position']);
    }

    public function testOneCellDoorInAWall(): void
    {
        $w = $this->bigScene();
        $f = $w['bigFloor'];
        // Vertical wall x = 20 (y 0 -> 40) with an open 1-cell door from y = 6 to 7.
        $this->fill($w['gm'], $w['big'], [
            self::wallObject('wall-v', $f, [[20, 0], [20, 40]]),
            self::doorObject('door-v', $f, [20, 6], [20, 7], false, ['props' => ['state' => 'open', 'locked' => false, 'secret' => false, 'asset_open' => null, 'asset_closed' => null, 'swing' => 'a']]),
        ]);
        $this->actOk($w['gm'], $w['session'], [self::move('t-elf', 18, 6.5)]);
        self::assertSame(['index' => 0, 'ok' => true, 'uid' => 't-elf', 'x' => 22, 'y' => 6.5, 'rotation' => 0], $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 22, 6.5)])[0]);
        // Beside the door, the wall stops him at x = 20 + 0.41.
        $hit = $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 22, 10), self::move('t-elf', 18, 10)])[1];
        self::assertEquals(['x' => 20.41, 'y' => 10], $hit['position']);
    }

    public function testHiddenObjectsDoNotBlockThePlayers(): void
    {
        $w = $this->bigScene();
        // gm-vis (visibility gm, y = 3, x 5-6) and hidden-vis (hidden_until_revealed, x 7-8): not seen, not blocking.
        self::assertTrue($this->actOk($w['bob'], $w['session'], [self::move('t-elf', 5.5, 2.5)])[0]['ok']);
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 7.5, 5)]);
        self::assertTrue($this->actOk($w['bob'], $w['session'], [self::move('t-elf', 7.5, 2.5)])[0]['ok']);
        // Revealed, hidden-vis blocks like any wall.
        $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 7.5, 5)]);
        $this->actOk($w['gm'], $w['session'], [['type' => 'reveal', 'kind' => 'object', 'uid' => 'hidden-vis']]);
        self::assertSame('blocked_by_wall', $this->actOk($w['bob'], $w['session'], [self::move('t-elf', 7.5, 2.5)])[0]['error'] ?? null);
    }
}
