<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Domain\Sessions\FogScope;
use JDR\Domain\Sessions\FogStrictScope;
use JDR\Domain\Sessions\SessionContext;
use JDR\Domain\Sessions\SessionRepository;

/**
 * fog_strict scope (D4 / D11): explored blocks UNION disk of radius vision.range + 2 around the
 * assigned tokens, 32 x 32 blocks.
 */
final class FogStrictScopeTest extends SessionsTestCase
{
    public function testDiskBlocks(): void
    {
        // radius 8 around (5, 5): block (0, 0) only.
        self::assertSame(['0:0'], FogStrictScope::disk(5, 5, 8));
        // (30, 5): the disk crosses x = 32.
        self::assertSame(['0:0', '1:0'], FogStrictScope::disk(30, 5, 8));
        // (30, 30): four blocks (the corner is 2.83 away).
        self::assertSame(['0:0', '1:0', '0:1', '1:1'], FogStrictScope::disk(30, 30, 8));
        // Exactly 8 cells from the next block: inclusive.
        self::assertSame(['0:0', '1:0'], FogStrictScope::disk(24, 5, 8));
        self::assertSame(['0:0'], FogStrictScope::disk(23.9, 5, 8));
        // Diagonal: (24, 24) is 11.3 from the corner (32, 32): not in the diagonal block.
        self::assertSame(['0:0', '1:0', '0:1'], FogStrictScope::disk(24, 24, 8));
        // Negative coordinates stay in the map.
        self::assertSame(['0:0'], FogStrictScope::disk(-3, 2, 8));
        self::assertSame([], FogStrictScope::disk(-30, 2, 8));
    }

    public function testScopeValue(): void
    {
        $scope = FogScope::of([7 => ['0:0' => true, '2:1' => true], 8 => []]);
        self::assertTrue($scope->isRestricted());
        self::assertTrue($scope->allowsBlock(7, 2, 1));
        self::assertFalse($scope->allowsBlock(7, 1, 1));
        self::assertFalse($scope->allowsBlock(9, 0, 0));
        self::assertTrue($scope->allowsPoint(7, 70.5, 40));
        self::assertFalse($scope->allowsPoint(7, 70.5, 64));
        self::assertFalse($scope->allowsPoint(7, -1, 5));
        self::assertTrue($scope->allowsBox(7, [60.0, 30.0, 70.0, 33.0]), 'a box touching block (2, 1)');
        self::assertFalse($scope->allowsBox(7, [33.0, 0.0, 60.0, 31.0]));
        self::assertTrue($scope->allowsBox(7, [-5.0, -5.0, 1.0, 1.0]));
        self::assertFalse($scope->allowsBox(8, [0.0, 0.0, 200.0, 200.0]));
        self::assertTrue($scope->allowsBox(7, [0.0, 0.0, 6000.0, 6000.0]), 'a huge box is tested against the allowed blocks');
        self::assertFalse($scope->allowsBox(7, [100.0, 100.0, 6000.0, 6000.0]));
        self::assertSame([[0, 0], [2, 1]], $scope->cells(7));
        self::assertSame([[2, 1]], $scope->filterCells(7, [[1, 1], [2, 1]]));
        self::assertSame([[0, 0], [2, 1]], $scope->filterCells(7, null));
        self::assertSame([], $scope->filterCells(9, null));
        self::assertSame([7], $scope->floors());

        $open = FogScope::unrestricted();
        self::assertFalse($open->isRestricted());
        self::assertTrue($open->allowsBlock(1, 99, 99));
        self::assertTrue($open->allowsBox(1, [0.0, 0.0, 1.0, 1.0]));
        self::assertNull($open->cells(1));
        self::assertNull($open->filterCells(1, null));
        self::assertSame([[1, 1]], $open->filterCells(1, [[1, 1]]));
    }

    public function testForUsersFromTheDatabase(): void
    {
        $w = $this->bigScene();
        $repo = $this->app->container()->get(SessionRepository::class);
        $service = $this->app->container()->get(FogStrictScope::class);
        $session = $repo->find((int) $w['session']);
        self::assertNotNull($session);
        $ctx = new SessionContext($session, $this->userId('Alice'), ['fog_strict' => true], SessionContext::PLAYER);
        $floor = (int) $w['bigFloor'];
        $bob = $this->userId('Bob');
        $dan = $this->userId('Dan');

        $scopes = $service->forUsers($ctx, (int) $w['big'], [$bob, $dan]);
        self::assertSame([[0, 0]], $scopes[$bob]->cells($floor), 'elf at (5, 5), range 12 + 2');
        self::assertSame([[0, 0]], $scopes[$dan]->cells($floor), 'dwarf at (9, 9)');
        self::assertSame([[0, 0]], $service->forUser($ctx, $bob, (int) $w['big'])->cells($floor));

        // Explored fog is shared; a token near a boundary opens the neighbour block.
        $this->explore($w['big'], $w['bigFloor'], 3, 3);
        $this->db->execute('UPDATE ' . $this->db->t('map_tokens') . ' SET `x` = 30, `y` = 5 WHERE `uid` = ?', ['t-elf']);
        $scopes = $service->forUsers($ctx, (int) $w['big'], [$bob, $dan]);
        self::assertEqualsCanonicalizing([[0, 0], [1, 0], [3, 3]], $scopes[$bob]->cells($floor));
        self::assertEqualsCanonicalizing([[0, 0], [3, 3]], $scopes[$dan]->cells($floor));
        self::assertSame([], $scopes[$bob]->cells($floor + 1) ?? [], 'nothing on another floor');

        // A token without vision still opens its 2 cells (the corner block (1, 1) is 2.83 away).
        $this->db->execute('UPDATE ' . $this->db->t('tokens') . ' SET `vision` = ? WHERE `name` = ?', ['{"enabled":false,"range":50,"dark":0}', 'Elfe']);
        $this->db->execute('UPDATE ' . $this->db->t('map_tokens') . ' SET `x` = 30, `y` = 30 WHERE `uid` = ?', ['t-elf']);
        self::assertEqualsCanonicalizing([[0, 0], [1, 0], [0, 1], [3, 3]], $service->forUser($ctx, $bob, (int) $w['big'])->cells($floor));
        $this->db->execute('UPDATE ' . $this->db->t('map_tokens') . ' SET `x` = 10, `y` = 10 WHERE `uid` = ?', ['t-elf']);
        self::assertEqualsCanonicalizing([[0, 0], [3, 3]], $service->forUser($ctx, $bob, (int) $w['big'])->cells($floor));

        // fog_strict off: no restriction.
        $open = new SessionContext($session, $this->userId('Alice'), ['fog_strict' => false], SessionContext::PLAYER);
        self::assertFalse($service->forUser($open, $bob, (int) $w['big'])->isRestricted());
    }
}
