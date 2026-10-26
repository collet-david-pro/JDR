<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

use JDR\Maps\Collision;
use PHPUnit\Framework\TestCase;

/**
 * D8: movement collision (pure): walls with blocks_move, windows, closed doors, secret doors not
 * revealed; widened segment (r = 0.4 x size x scale), last valid point, 1-cell door passage.
 */
final class CollisionTest extends TestCase
{
    /**
     * @param list<array{0: float|int, 1: float|int}> $points
     * @return array<string, mixed>
     */
    private static function wall(string $uid, array $points, bool $blocksMove = true): array
    {
        return [
            'uid' => $uid, 'floor' => '1', 'type' => 'wall', 'layer' => 'walls',
            'geometry' => ['points' => $points, 'closed' => false],
            'props' => ['kind' => 'stone', 'thickness' => 0.15, 'blocks_vision' => true, 'blocks_light' => true, 'blocks_move' => $blocksMove, 'texture_asset' => null, 'height' => null],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function door(string $uid, array $a, array $b, string $state = 'closed', bool $secret = false): array
    {
        return [
            'uid' => $uid, 'floor' => '1', 'type' => 'door', 'layer' => 'walls',
            'geometry' => ['a' => $a, 'b' => $b],
            'props' => ['state' => $state, 'locked' => false, 'secret' => $secret, 'asset_open' => null, 'asset_closed' => null, 'swing' => 'a'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function window(string $uid, array $a, array $b): array
    {
        return ['uid' => $uid, 'floor' => '1', 'type' => 'window', 'layer' => 'walls', 'geometry' => ['a' => $a, 'b' => $b], 'props' => ['kind' => 'glass']];
    }

    /**
     * A vertical wall x = 10 from y = 0 to 20 with an opening (door / window) from y = 9.5 to 10.5.
     *
     * @param array<string, mixed>|null $opening
     * @return list<array{0: float, 1: float, 2: float, 3: float}>
     */
    private static function room(?array $opening, array $revealed = []): array
    {
        $objects = [self::wall('w', [[10, 0], [10, 20]])];
        if ($opening !== null) {
            $objects[] = $opening;
        }

        return Collision::segments($objects, array_fill_keys($revealed, true));
    }

    private static function go(array $segments, float $px, float $py, float $qx, float $qy, float $r = 0.4): array
    {
        return Collision::move($segments, $px, $py, $qx, $qy, $r);
    }

    public function testRadius(): void
    {
        self::assertEqualsWithDelta(0.4, Collision::radius(1, 1, 1), 1e-9);
        self::assertEqualsWithDelta(0.8, Collision::radius(2, 3, 1), 1e-9);
        self::assertEqualsWithDelta(0.2, Collision::radius(1, 1, 0.5), 1e-9);
    }

    public function testWallStopsAtTheLastValidPoint(): void
    {
        $hit = self::go(self::room(null), 5, 10, 15, 10);
        self::assertTrue($hit['blocked']);
        // Contact when the centre is r = 0.4 from the wall, then moved back by RECOIL.
        self::assertEqualsWithDelta(10 - 0.4 - Collision::RECOIL, $hit['x'], 1e-6);
        self::assertEqualsWithDelta(10.0, $hit['y'], 1e-9);
        // Diagonal approach: same distance to the wall, along the segment.
        $hit = self::go(self::room(null), 5, 5, 15, 15);
        self::assertTrue($hit['blocked']);
        self::assertEqualsWithDelta(Collision::distance($hit['x'], $hit['y'], 10, 0, 10, 20), 0.4 + Collision::RECOIL / sqrt(2), 1e-4);
        // Not reaching the wall: free.
        self::assertSame(['x' => 9.5, 'y' => 10.0, 'blocked' => false], self::go(self::room(null), 5, 10, 9.5, 10.0));
        // A wide token stops earlier.
        self::assertEqualsWithDelta(10 - 1.2 - Collision::RECOIL, self::go(self::room(null), 5, 10, 15, 10, 1.2)['x'], 1e-6);
    }

    public function testWallWithoutBlocksMoveDoesNotBlock(): void
    {
        $segments = Collision::segments([self::wall('w', [[10, 0], [10, 20]], false)], []);
        self::assertFalse(self::go($segments, 5, 10, 15, 10)['blocked']);
    }

    public function testOpenDoorOfOneCellLetsAOneCellTokenThrough(): void
    {
        $segments = self::room(self::door('d', [10, 9.5], [10, 10.5], 'open'));
        self::assertSame(['x' => 15.0, 'y' => 10.0, 'blocked' => false], self::go($segments, 5, 10, 15, 10));
        // Off-centre by 0.05: still passes (0.5 - 0.05 > 0.4).
        self::assertFalse(self::go($segments, 5, 10.05, 15, 10.05)['blocked']);
        // A 2 x 2 token (r = 0.8) does not.
        self::assertTrue(self::go($segments, 5, 10, 15, 10, 0.8)['blocked']);
        // Beside the door: the wall.
        self::assertTrue(self::go($segments, 5, 12, 15, 12)['blocked']);
    }

    public function testClosedDoorAndWindowBlock(): void
    {
        foreach ([self::door('d', [10, 9.5], [10, 10.5]), self::window('win', [10, 9.5], [10, 10.5])] as $opening) {
            $hit = self::go(self::room($opening), 5, 10, 15, 10);
            self::assertTrue($hit['blocked'], $opening['type']);
            self::assertEqualsWithDelta(10 - 0.4 - Collision::RECOIL, $hit['x'], 1e-6);
        }
        // A free-standing closed door blocks too.
        self::assertTrue(self::go(Collision::segments([self::door('d', [10, 9], [10, 11])], []), 5, 10, 15, 10)['blocked']);
    }

    public function testSecretDoorBlocksUntilRevealed(): void
    {
        $secret = self::door('s', [10, 9.5], [10, 10.5], 'open', true);
        self::assertTrue(self::go(self::room($secret), 5, 10, 15, 10)['blocked'], 'hidden: a wall even when open');
        self::assertFalse(self::go(self::room($secret, ['s']), 5, 10, 15, 10)['blocked'], 'revealed and open');
        $closed = self::door('s', [10, 9.5], [10, 10.5], 'closed', true);
        self::assertTrue(self::go(self::room($closed, ['s']), 5, 10, 15, 10)['blocked'], 'revealed but closed');
    }

    public function testTokenAgainstAWallMayMoveAway(): void
    {
        $segments = self::room(null);
        // Centre 0.2 from the wall (closer than r): moving away or along is allowed.
        self::assertFalse(self::go($segments, 9.8, 10, 5, 10)['blocked']);
        self::assertFalse(self::go($segments, 9.8, 10, 9.8, 15)['blocked']);
        // Moving closer is not: it stays where it is.
        $hit = self::go($segments, 9.8, 10, 12, 10);
        self::assertTrue($hit['blocked']);
        self::assertEqualsWithDelta(9.8, $hit['x'], 1e-3);
    }

    public function testWallEndsAndPolylines(): void
    {
        $segments = Collision::segments([self::wall('w', [[10, 0], [10, 10], [20, 10]])], []);
        // Past the end of the wall at (10, 0), more than r away: free.
        self::assertFalse(self::go($segments, 5, -1, 15, -1)['blocked']);
        // Into the corner: blocked by the vertical part.
        self::assertTrue(self::go($segments, 5, 5, 15, 5)['blocked']);
        // Brushing the end point (10, 0) within r: blocked.
        self::assertTrue(self::go($segments, 5, -0.3, 15, -0.3)['blocked']);
    }
}
