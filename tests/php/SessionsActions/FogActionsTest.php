<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * fog.reveal / fog.hide (D9): a player's bits are ANDed with the disks (position,
 * vision.range + 1) of his assigned tokens on the floor, the rest is never stored and counted in
 * rejected_bits; the GM reveals anywhere and hides; fog.updated carries the changed bits.
 */
final class FogActionsTest extends ActionsTestCase
{
    private static function reveal(string $floor, array $chunks, string $type = 'fog.reveal'): array
    {
        return ['type' => $type, 'floor' => $floor, 'chunks' => array_map(static fn (array $c): array => [$c[0], $c[1], self::b64($c[2])], $chunks)];
    }

    public function testPlayerBitsOutOfRangeAreRejectedAndNeverStored(): void
    {
        $w = $this->bigScene();
        // Elf at (5, 5), vision 12 => disk of radius 13. Whole block 0:0 sent.
        $all = str_repeat("\xff", 2048);
        $head = $this->head();
        $result = $this->actOk($w['bob'], $w['session'], [self::reveal($w['bigFloor'], [[0, 0, $all]])])[0];
        $stored = $this->storedFog($w['big'], $w['bigFloor'], 0, 0);
        $kept = self::bitCount($stored);
        self::assertGreaterThan(0, $kept);
        self::assertSame(128 * 128 - $kept, $result['rejected_bits']);
        self::assertSame(['index' => 0, 'ok' => true, 'rejected_bits' => $result['rejected_bits']], $result);
        // Every stored bit is a sub-cell whose centre is within 13 cells of (5, 5); the far corner is not.
        for ($i = 0; $i < 128 * 128; $i++) {
            if ((ord($stored[$i >> 3]) & (0x80 >> ($i & 7))) !== 0) {
                $x = (($i % 128) + 0.5) / 4;
                $y = (intdiv($i, 128) + 0.5) / 4;
                self::assertLessThanOrEqual(13.0, hypot($x - 5, $y - 5));
            }
        }
        self::assertSame(0, ord($stored[2047]) & 1);
        // Inside: (5, 5) +/- 1 cell is explored.
        self::assertSame(self::fogBits(0, 0, 4, 4, 6, 6) & $stored, self::fogBits(0, 0, 4, 4, 6, 6));
        // fog.updated: complete for the GM, to the players whose scope has the block.
        self::assertSame(['fog.updated/gm', 'fog.updated/user', 'fog.updated/user'], $this->kinds($head));
        $gm = $this->events($head)[0]['payload'];
        self::assertSame('reveal', $gm['op']);
        self::assertSame(self::b64($stored), self::b64((string) gzinflate(base64_decode($gm['chunks'][0][2]))));
    }

    public function testFarBlockIsEntirelyRejected(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $result = $this->actOk($w['bob'], $w['session'], [self::reveal($w['bigFloor'], [[4, 4, str_repeat("\xff", 2048)]])])[0];
        self::assertSame(128 * 128, $result['rejected_bits']);
        self::assertSame(0, $this->rows('map_fog'));
        self::assertSame($head, $this->head(), 'nothing changed: no event');
    }

    public function testDisksOfThePlayerOnly(): void
    {
        $w = $this->bigScene();
        // Cell (21, 9) is within 13 of Dan's dwarf at (9, 9), more than 16 from Bob's elf at (5, 5).
        $bits = self::fogBits(0, 0, 21, 9, 22, 10);
        self::assertSame(self::bitCount($bits), $this->actOk($w['bob'], $w['session'], [self::reveal($w['bigFloor'], [[0, 0, $bits]])])[0]['rejected_bits']);
        self::assertSame(0, $this->actOk($w['dan'], $w['session'], [self::reveal($w['bigFloor'], [[0, 0, $bits]])])[0]['rejected_bits']);
        self::assertSame($bits, $this->storedFog($w['big'], $w['bigFloor'], 0, 0));
    }

    public function testVisionDisabledAndHiddenTokens(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->patch('/tokens/' . $w['elf']['id'], ['vision' => ['enabled' => false, 'range' => 12, 'dark' => 0]]));
        $near = self::fogBits(0, 0, 5, 5, 6, 6);
        $mid = self::fogBits(0, 0, 8, 5, 9, 6);
        $r = $this->actOk($w['bob'], $w['session'], [self::reveal($w['bigFloor'], [[0, 0, $near | $mid]])])[0];
        $stored = $this->storedFog($w['big'], $w['bigFloor'], 0, 0);
        self::assertSame(str_repeat("\0", 2048), $stored & $mid, 'radius 1 without vision: (8, 5) is out');
        self::assertGreaterThan(0, self::bitCount($stored & $near));
        self::assertSame(self::bitCount($near | $mid) - self::bitCount($stored), $r['rejected_bits']);
        // A hidden token gives no range.
        $this->ok($w['gm']->patch('/tokens/' . $w['elf']['id'], ['vision' => ['enabled' => true, 'range' => 12, 'dark' => 0]]));
        $this->opsOk($w['gm'], $w['big'], [['type' => 'maptoken.update', 'uid' => 't-elf', 'rev' => 100, 'patch' => ['hidden' => true]]]);
        self::assertSame(self::bitCount($mid), $this->actOk($w['bob'], $w['session'], [self::reveal($w['bigFloor'], [[0, 0, $mid]])])[0]['rejected_bits']);
    }

    public function testGmRevealsAnywhereAndHides(): void
    {
        $w = $this->bigScene();
        $far = self::fogBits(4, 4, 140, 140, 150, 150);
        $result = $this->actOk($w['gm'], $w['session'], [self::reveal($w['bigFloor'], [[4, 4, $far]])])[0];
        self::assertSame(['index' => 0, 'ok' => true, 'rejected_bits' => 0], $result);
        self::assertSame($far, $this->storedFog($w['big'], $w['bigFloor'], 4, 4));
        // Hide part of it: AND NOT; fog.updated with the removed bits.
        $part = self::fogBits(4, 4, 140, 140, 145, 150);
        $head = $this->head();
        self::assertSame([['index' => 0, 'ok' => true]], $this->actOk($w['gm'], $w['session'], [self::reveal($w['bigFloor'], [[4, 4, $part]], 'fog.hide')]));
        self::assertSame($far & ~$part, $this->storedFog($w['big'], $w['bigFloor'], 4, 4));
        $gm = $this->events($head)[0];
        self::assertSame('hide', $gm['payload']['op']);
        self::assertSame($part, gzinflate(base64_decode($gm['payload']['chunks'][0][2])));
        // Everything hidden: the row goes.
        $this->actOk($w['gm'], $w['session'], [self::reveal($w['bigFloor'], [[4, 4, $far]], 'fog.hide')]);
        self::assertSame(0, $this->rows('map_fog'));
        self::assertSame(403, $this->act($w['bob'], $w['session'], [self::reveal($w['bigFloor'], [[0, 0, $far]], 'fog.hide')])->status());
    }

    public function testNewlyExploredBlockEntersEveryScope(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->actOk($w['gm'], $w['session'], [self::reveal($w['bigFloor'], [[5, 5, self::fogBits(5, 5, 170, 170, 171, 171)]])]);
        $bob = $this->received($w['bob'], $w['channel'], $head);
        // The block was outside his scope when the bits came: no fog.updated, but the block enters
        // his scope (map.ops.public chunks: he loads its tiles and fog).
        self::assertNotContains('fog.updated', array_column($bob, 'type'));
        $ops = array_values(array_filter($bob, static fn (array $e): bool => $e['type'] === 'map.ops.public'));
        self::assertSame([[$w['bigFloor'], 5, 5]], $ops[0]['payload']['chunks']);
        self::assertContains('wall-far', array_column($ops[0]['payload']['objects']['upsert'], 'uid'));
        $added = array_values(array_filter($bob, static fn (array $e): bool => $e['type'] === 'maptoken.added'));
        self::assertSame(['t-goblin-far'], array_column(array_column($added, 'payload'), 'uid'));
    }

    public function testValidation(): void
    {
        $w = $this->bigScene();
        $f = $w['bigFloor'];
        $ok = self::b64(str_repeat("\0", 2048));
        $cases = [
            [['type' => 'fog.reveal', 'floor' => $f], ['actions.0.chunks' => 'required']],
            [['type' => 'fog.reveal', 'floor' => $f, 'chunks' => []], ['actions.0.chunks' => 'invalid']],
            [['type' => 'fog.reveal', 'floor' => $f, 'chunks' => array_fill(0, 201, [0, 0, $ok])], ['actions.0.chunks' => 'too_many']],
            [['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[0, 0, 'abc']]], ['actions.0.chunks.0' => 'invalid']],
            [['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[0, 0, base64_encode(gzdeflate('short'))]]], ['actions.0.chunks.0' => 'invalid']],
            [['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[7, 0, $ok]]], ['actions.0.chunks.0' => 'invalid']],
            [['type' => 'fog.reveal', 'floor' => '999999', 'chunks' => [[0, 0, $ok]]], ['actions.0.floor' => 'not_found']],
            [['type' => 'fog.reveal', 'chunks' => [[0, 0, $ok]]], ['actions.0.floor' => 'required']],
        ];
        foreach ($cases as $i => [$action, $fields]) {
            $r = $this->act($w['gm'], $w['session'], [$action]);
            self::assertSame(422, $r->status(), (string) $i);
            self::assertSame($fields, $r->payload()['error']['fields'], (string) $i);
        }
    }
}
