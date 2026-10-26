<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

/**
 * Fog of war (projet.md 12.3, etapes/P05): fog.reveal (bitwise OR) / fog.hide (AND NOT) ops,
 * empty chunks deleted, GET /maps/{id}/fog kept after a reload, DELETE /maps/{id}/fog.
 */
final class MapFogTest extends MapsP5TestCase
{
    public function testRevealHideAndPersistence(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $a = self::fogBits([[0, 0], [1, 0], [127, 127]]);
        $b = self::fogBits([[1, 0], [64, 3]]);
        $r = $this->opsOk($gm, $map['id'], [
            self::fogOp('fog.reveal', $f, [[0, 0, $a], [1, 1, $b]]),
            self::fogOp('fog.reveal', $f, [[0, 0, $b]]),
        ]);
        self::assertSame(['revision' => 1, 'applied' => 2, 'conflicts' => []], $r);
        $expected = ['0:0' => self::fogBits([[0, 0], [1, 0], [127, 127], [64, 3]]), '1:1' => $b];
        self::assertSame($expected, $this->fogOf($gm, $map['id'], $f));

        // Kept after a "reload": a new session reads the same bits.
        $gm->dropSession();
        $again = $this->login('Alice');
        self::assertSame($expected, $this->fogOf($again, $map['id'], $f));
        self::assertSame(2, $this->rows('map_fog', '`map_id` = ?', [(int) $map['id']]));

        // hide = AND NOT; a chunk that becomes empty is deleted.
        $this->opsOk($again, $map['id'], [
            self::fogOp('fog.hide', $f, [[0, 0, self::fogBits([[0, 0], [5, 5]])], [1, 1, $b]]),
        ]);
        self::assertSame(['0:0' => self::fogBits([[1, 0], [127, 127], [64, 3]])], $this->fogOf($again, $map['id'], $f));
        self::assertSame(1, $this->rows('map_fog', '`map_id` = ?', [(int) $map['id']]));
        // hide on a chunk without fog: nothing stored.
        $this->opsOk($again, $map['id'], [self::fogOp('fog.hide', $f, [[1, 0, $a]])]);
        self::assertSame(1, $this->rows('map_fog', '`map_id` = ?', [(int) $map['id']]));
        // An all-zero reveal is accepted and stores nothing.
        $this->opsOk($again, $map['id'], [self::fogOp('fog.reveal', $f, [[1, 0, str_repeat("\0", 2048)]])]);
        self::assertSame(1, $this->rows('map_fog', '`map_id` = ?', [(int) $map['id']]));
        // Stored data: raw deflate of exactly 2 048 bytes.
        $data = (string) $this->db->fetchValue('SELECT `data` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ?', [(int) $map['id']]);
        self::assertSame(2048, strlen((string) gzinflate($data, 2048)));
    }

    public function testFloorsAreSeparateAndDeleteClearsOneFloor(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_floors') . ' (`map_id`, `level`, `name`, `sort_order`) VALUES (?, 1, ?, 1)',
            [(int) $map['id'], 'Étage'],
        );
        $f2 = (string) $this->db->lastInsertId();
        $bits = self::fogBits([[3, 3]]);
        $this->opsOk($gm, $map['id'], [self::fogOp('fog.reveal', $f, [[0, 0, $bits]]), self::fogOp('fog.reveal', $f2, [[1, 0, $bits]])]);
        self::assertSame(['0:0' => $bits], $this->fogOf($gm, $map['id'], $f));
        self::assertSame(['1:0' => $bits], $this->fogOf($gm, $map['id'], $f2));

        $before = $this->revision($map['id']);
        $r = $gm->delete('/maps/' . $map['id'] . '/fog?floor=' . $f);
        self::assertSame(200, $r->status(), $r->body());
        self::assertSame(['revision' => $before + 1], self::data($r));
        self::assertSame($before + 1, $this->revision($map['id']));
        self::assertSame([], $this->fogOf($gm, $map['id'], $f));
        self::assertSame(['1:0' => $bits], $this->fogOf($gm, $map['id'], $f2));
        // Again (nothing left): still 200, revision + 1.
        self::assertSame(['revision' => $before + 2], self::data($gm->delete('/maps/' . $map['id'] . '/fog?floor=' . $f)));

        // floor parameter.
        $other = $this->newMap($gm, $map['game_id'], ['name' => 'Autre']);
        foreach (['get', 'delete'] as $method) {
            self::assertFieldErrors($gm->{$method}('/maps/' . $map['id'] . '/fog'), ['floor' => 'required']);
            self::assertFieldErrors($gm->{$method}('/maps/' . $map['id'] . '/fog?floor=abc'), ['floor' => 'invalid']);
            self::assertFieldErrors($gm->{$method}('/maps/' . $map['id'] . '/fog?floor=' . $other['floors'][0]['id']), ['floor' => 'not_found']);
        }
        self::assertSame($before + 2, $this->revision($map['id']));
    }

    public function testValidation(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene(['width' => 40, 'height' => 33]);
        $bits = self::fogBits([[0, 0]]);
        $wire = self::fogWire($bits);
        $op = static fn (mixed $chunks, array $over = []): array => $over + ['type' => 'fog.reveal', 'floor' => $f, 'chunks' => $chunks];
        $cases = [
            [['type' => 'fog.reveal', 'floor' => $f], ['ops.0.chunks' => 'required']],
            [$op('x'), ['ops.0.chunks' => 'invalid']],
            [$op(array_fill(0, 201, [0, 0, $wire])), ['ops.0.chunks' => 'too_many']],
            [$op([[0, 0]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[0, 0, $wire], ['0', 0, $wire]]), ['ops.0.chunks.1' => 'invalid']],
            [$op([[-1, 0, $wire]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[13, 0, $wire]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[2, 0, $wire]]), ['ops.0.chunks.0' => 'invalid']], // 2 * 32 >= 40
            [$op([[0, 1, $wire]]), ['ops.0.chunks.0' => 'invalid']], // 32 < 33: inside
            [$op([[0, 0, 'not base64!']]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[0, 0, base64_encode((string) gzdeflate(str_repeat("\1", 2047)))]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[0, 0, base64_encode((string) gzdeflate(str_repeat("\1", 2049)))]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[0, 0, base64_encode(str_repeat("\1", 2048))]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[0, 0, base64_encode((string) gzdeflate(str_repeat("\0", 10_000_000)))]]), ['ops.0.chunks.0' => 'invalid']],
            [$op([[0, 0, $wire]], ['floor' => 'abc']), ['ops.0.floor' => 'invalid']],
            [$op([[0, 0, $wire]], ['floor' => '999999']), ['ops.0.floor' => 'not_found']],
            [$op([[0, 0, $wire]], ['extra' => 1]), ['ops.0' => 'invalid']],
            [$op([[0, 0, $wire]], ['type' => 'fog.hide', 'floor' => null]), ['ops.0.floor' => 'invalid']],
        ];
        foreach ($cases as $i => [$fogOp, $errors]) {
            if ($i === 8) {
                // (0, 1) is inside a 33-cell-high map: accepted.
                $this->opsOk($gm, $map['id'], [$fogOp]);
                continue;
            }
            $before = $this->revision($map['id']);
            $response = $this->sendOps($gm, $map['id'], [$fogOp]);
            self::assertSame(422, $response->status(), 'case ' . $i . ': ' . $response->body());
            self::assertFieldErrors($response, $errors);
            self::assertSame($before, $this->revision($map['id']), 'case ' . $i);
        }
        self::assertSame(['0:1' => $bits], $this->fogOf($gm, $map['id'], $f));
    }

    public function testShrinkingTheMapDropsTheSceneOutsideIt(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard] = $this->p5Scene();
        $bits = self::fogBits([[0, 0]]);
        $this->opsOk($gm, $map['id'], [
            self::addObject(self::wall('in', $f, [[1, 1], [20, 1]], ['props' => self::wallProps(['thickness' => 2])])),
            self::addObject(self::wall('out', $f, [[1, 1], [50, 1]])),
            self::addObject(self::light('lamp', $f, 15, 15, ['props' => self::lightProps(['dim_radius' => 30])])),
            self::addToken(self::placed('t-in', $f, $guard['id'], ['x' => 30, 'y' => 30])),
            self::addToken(self::placed('t-out', $f, $guard['id'], ['x' => 31, 'y' => 2])),
            self::fogOp('fog.reveal', $f, [[0, 0, $bits], [1, 0, $bits], [0, 1, $bits]]),
        ]);
        $this->opsOk($gm, $map['id'], [['type' => 'map.meta', 'grid' => ['width' => 30, 'height' => 33]]]);
        self::assertSame(['in', 'lamp'], array_keys($this->objectsOf($gm, $map['id'])));
        self::assertSame(['t-in'], array_keys($this->tokensOf($gm, $map['id'])));
        self::assertEquals([0, 0, 30, 33], $this->sceneRepository()->bboxes((int) $map['id'])['lamp'], 'bounded again');
        self::assertSame(['0:0', '0:1'], array_keys($this->fogOf($gm, $map['id'], $f)));
    }
}
