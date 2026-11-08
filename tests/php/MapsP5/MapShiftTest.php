<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

/**
 * Resize with an anchor: map.meta grid {width, height, shift_x, shift_y} moves every tile, object,
 * placed token and fog chunk in the same lot as the new size; what leaves the map is deleted.
 */
final class MapShiftTest extends MapsP5TestCase
{
    /**
     * @return array{gm: \JDR\Tests\Api\ApiClient, map: array<string, mixed>, floor: string}
     */
    private function content(int $width, int $height): array
    {
        $s = $this->scene(['width' => $width, 'height' => $height]);
        $guard = $this->newToken($s['gm'], $s['game']['id'], ['name' => 'Garde', 'kind' => 'npc']);
        $f = $s['floor'];
        $this->opsOk($s['gm'], $s['map']['id'], [
            self::tiles($f, 'ground', [[0, 0, 1], [9, 9, 2], [5, 5, 1]]),
            self::addObject(self::wall('w', $f, [[2, 2], [8, 2]])),
            self::addObject(self::light('lamp', $f, 5, 5)),
            self::addToken(self::placed('t', $f, $guard['id'], ['x' => 3, 'y' => 3])),
            self::fogOp('fog.reveal', $f, [[0, 0, self::fogBits([[0, 0], [39, 39]])]]),
        ]);

        return ['gm' => $s['gm'], 'map' => $s['map'], 'floor' => $f];
    }

    public function testGrowingWithAnAnchorMovesEverythingAndShrinkingBackRestoresIt(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->content(10, 10);
        $id = $map['id'];
        $before = $this->storedCells($id);

        $this->opsOk($gm, $id, [['type' => 'map.meta', 'grid' => ['width' => 20, 'height' => 15, 'shift_x' => 5, 'shift_y' => 2]]]);
        self::assertEqualsCanonicalizing(
            [$f . '|ground|5,2' => [1, 0, 0], $f . '|ground|14,11' => [2, 0, 0], $f . '|ground|10,7' => [1, 0, 0]],
            $this->storedCells($id),
        );
        $objects = $this->objectsOf($gm, $id);
        self::assertEquals([[7, 4], [13, 4]], $objects['w']['geometry']['points']);
        self::assertEquals(10, $objects['lamp']['geometry']['x']);
        self::assertEquals(7, $objects['lamp']['geometry']['y']);
        $token = $this->tokensOf($gm, $id)['t'];
        self::assertEquals([8, 5], [$token['x'], $token['y']]);
        self::assertSame(['0:0' => self::fogBits([[20, 8], [59, 47]])], $this->fogOf($gm, $id, $f));
        self::assertEquals(['width' => 20, 'height' => 15], array_intersect_key(self::data($gm->get('/maps/' . $id))['grid'], ['width' => 1, 'height' => 1]));
        self::assertSame($this->recountRefs($id), $this->storedRefs($id));

        // The opposite shift with the old size gives the original content back.
        $this->opsOk($gm, $id, [['type' => 'map.meta', 'grid' => ['width' => 10, 'height' => 10, 'shift_x' => -5, 'shift_y' => -2]]]);
        self::assertEqualsCanonicalizing($before, $this->storedCells($id));
        self::assertEquals([[2, 2], [8, 2]], $this->objectsOf($gm, $id)['w']['geometry']['points']);
        self::assertSame(self::fogBits([[0, 0], [39, 39]]), $this->fogOf($gm, $id, $f)['0:0']);
    }

    public function testCroppingFromTheTopLeftDropsWhatLeavesTheMap(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->content(10, 10);
        $id = $map['id'];

        // Crop 3 columns / 3 rows on the top-left side: new map 7 x 7, everything moves by -3.
        $this->opsOk($gm, $id, [['type' => 'map.meta', 'grid' => ['width' => 7, 'height' => 7, 'shift_x' => -3, 'shift_y' => -3]]]);
        self::assertEqualsCanonicalizing([$f . '|ground|6,6' => [2, 0, 0], $f . '|ground|2,2' => [1, 0, 0]], $this->storedCells($id));
        // The wall (2..8) no longer fits whole: deleted, like a shrink. The token and the lamp stay.
        self::assertSame(['lamp'], array_keys($this->objectsOf($gm, $id)));
        $token = $this->tokensOf($gm, $id)['t'];
        self::assertEquals([0, 0], [$token['x'], $token['y']]);
        self::assertSame($this->recountRefs($id), $this->storedRefs($id));
        // Fog: the sub-cell (0, 0) left the map, (39, 39) went to (27, 27).
        self::assertSame(['0:0' => self::fogBits([[27, 27]])], $this->fogOf($gm, $id, $f));
    }

    public function testAShiftNeedsTheCurrentRevisionAndAValidAmount(): void
    {
        ['gm' => $gm, 'map' => $map] = $this->content(10, 10);
        $r = $this->sendOps($gm, $map['id'], [['type' => 'map.meta', 'grid' => ['shift_x' => 1]]], 1);
        self::assertSame(409, $r->status());
        self::assertFieldErrors(
            $this->sendOps($gm, $map['id'], [['type' => 'map.meta', 'grid' => ['width' => 12, 'shift_x' => 'a']]]),
            ['ops.0.grid.shift_x' => 'invalid'],
        );
    }
}
