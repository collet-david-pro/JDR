<?php

declare(strict_types=1);

namespace JDR\Tests\Maps;

/**
 * POST /maps/{id}/ops (projet.md 11.4, contract P4b): each op, limits, conflicts, idempotence,
 * exact map_asset_refs.
 */
final class MapOpsTest extends MapsTestCase
{
    public function testTilesSetWritesLastWriterWinsAndDeletesEmptyChunks(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a, 'b' => $b] = $this->scene();
        $result = $this->opsOk($gm, $map['id'], [
            self::tiles($floor, 'ground', [[0, 0, 1], [1, 0, 1, 2, 3], [0, 0, 2, 4, 5]]),
            self::tiles($floor, 'terrain', [[59, 39, 2]]),
        ]);
        self::assertSame(['revision' => 2, 'applied' => 2, 'conflicts' => []], $result);
        self::assertSame([
            $floor . '|ground|0,0' => [2, 4, 5],
            $floor . '|ground|1,0' => [1, 2, 3],
            $floor . '|terrain|59,39' => [2, 0, 0],
        ], $this->storedCells($map['id']));
        self::assertSame(2, (int) $this->db->fetchValue('SELECT `revision` FROM ' . $this->db->t('map_chunks') . " WHERE `layer` = 'terrain'"));
        self::assertSame([(int) $a['id'] => 1, (int) $b['id'] => 2], $this->storedRefs($map['id']));

        // Erasing (index 0, variant/flags ignored) the last cells removes the rows.
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 0, 9, 9], [1, 0, 0]])]);
        self::assertSame(0, $this->rows('map_chunks', "`layer` = 'ground'"));
        self::assertSame([(int) $b['id'] => 1], $this->storedRefs($map['id']));
        self::assertSame(3, $this->revision($map['id']));
    }

    public function testPaletteAdd(): void
    {
        ['gm' => $gm, 'map' => $map, 'a' => $a, 'b' => $b] = $this->scene();
        $other = $this->uploadOk($gm, 'valid_webp_lossless.webp', ['kind' => 'tile']);
        // Same asset at the same index: no-op; append with autotile.
        $this->opsOk($gm, $map['id'], [
            self::paletteAdd(1, $a['id']),
            ['type' => 'palette.add', 'index' => 3, 'asset_id' => $other['id'], 'autotile' => 'wall-47'],
        ]);
        $palette = self::data($gm->get('/maps/' . $map['id']))['palette'];
        self::assertCount(4, $palette);
        self::assertNull($palette[0]);
        self::assertSame('wall-47', $palette[3]['autotile']);
        self::assertSame($other['id'], $palette[3]['asset_id']);

        // Another asset at a used index: 409 (the client reloads).
        $r = $this->sendOps($gm, $map['id'], [self::paletteAdd(2, $a['id'])]);
        self::assertSame(409, $r->status());
        self::assertSame('revision_conflict', self::errorCode($r));
        // Index beyond the end: 422.
        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::paletteAdd(5, $a['id'])]), ['ops.0.index' => 'palette_index']);
        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::paletteAdd(0, $a['id'])]), ['ops.0.index' => 'palette_index']);
        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::paletteAdd(4096, $a['id'])]), ['ops.0.index' => 'palette_index']);
        self::assertFieldErrors(
            $this->sendOps($gm, $map['id'], [['type' => 'palette.add', 'index' => 4, 'asset_id' => $a['id'], 'autotile' => 'x y']]),
            ['ops.0.autotile' => 'invalid'],
        );
        self::assertSame(4, count(self::data($gm->get('/maps/' . $map['id']))['palette']), 'nothing written by refused lots');
    }

    public function testPaletteAssetMustBeVisibleToTheEditor(): void
    {
        ['gm' => $gm, 'map' => $map, 'game' => $game] = $this->scene();
        $dave = $this->user('Dave');
        $foreign = $this->uploadOk($dave, 'valid_webp_lossless.webp', ['kind' => 'tile']);
        $admin = $this->user('Root', 'admin');
        $general = $this->uploadOk($admin, 'valid_gif_static.gif', ['kind' => 'tile', 'scope' => 'general']);

        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::paletteAdd(3, $foreign['id'])]), ['ops.0.asset_id' => 'not_found']);
        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::paletteAdd(3, '999999')]), ['ops.0.asset_id' => 'not_found']);
        $this->opsOk($gm, $map['id'], [self::paletteAdd(3, $general['id'])]);

        // A co-GM may use the GM's personal asset already used by the game (painted on a map).
        ['floor' => $floor] = ['floor' => $map['floors'][0]['id']];
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 1]])]);
        $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $coGm = $this->client('198.51.100.150');
        $coGm->login('Carol', self::PASSWORD);
        $second = $this->newMap($coGm, $game['id'], ['name' => 'Second']);
        $palette = self::data($gm->get('/maps/' . $map['id']))['palette'];
        $this->opsOk($coGm, $second['id'], [self::paletteAdd(1, $palette[1]['asset_id'])]);
        self::assertFieldErrors($this->sendOps($coGm, $second['id'], [self::paletteAdd(2, $palette[2]['asset_id'])]), ['ops.0.asset_id' => 'not_found']);
    }

    public function testTilesValidation(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor] = $this->scene();
        $cases = [
            [self::tiles($floor, 'ground', [[0, 0, 3]]), ['ops.0.cells.0' => 'palette_index']],
            [self::tiles($floor, 'ground', [[60, 0, 1]]), ['ops.0.cells.0' => 'out_of_bounds']],
            [self::tiles($floor, 'ground', [[0, 40, 1]]), ['ops.0.cells.0' => 'out_of_bounds']],
            [self::tiles($floor, 'ground', [[0, 400, 1]]), ['ops.0.cells.0' => 'out_of_bounds']],
            [self::tiles($floor, 'ground', [[-1, 0, 1]]), ['ops.0.cells.0' => 'out_of_bounds']],
            [self::tiles($floor, 'ground', [[0, 0, 1, 256, 0]]), ['ops.0.cells.0' => 'invalid']],
            [self::tiles($floor, 'ground', [[0, 0, 1, 0, 16]]), ['ops.0.cells.0' => 'invalid']],
            [self::tiles($floor, 'ground', [[0, 0, 65536]]), ['ops.0.cells.0' => 'invalid']],
            [['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground', 'cells' => [[0, 0, 1, 0]]], ['ops.0.cells.0' => 'invalid']],
            [['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground', 'cells' => [[0, '0', 1, 0, 0]]], ['ops.0.cells.0' => 'invalid']],
            [self::tiles($floor, 'walls', [[0, 0, 1]]), ['ops.0.layer' => 'invalid']],
            [self::tiles('999999', 'ground', [[0, 0, 1]]), ['ops.0.floor' => 'not_found']],
            [self::tiles('abc', 'ground', [[0, 0, 1]]), ['ops.0.floor' => 'invalid']],
            [self::tiles($floor, 'ground', [[0, 0, 1]]) + ['extra' => 1], ['ops.0' => 'invalid']],
            [['type' => 'object.add'], ['ops.0.type' => 'invalid']],
            [['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground'], ['ops.0.cells' => 'required']],
        ];
        foreach ($cases as $i => [$op, $errors]) {
            self::assertFieldErrors($this->sendOps($gm, $map['id'], [$op]), $errors);
            self::assertSame(1, $this->revision($map['id']), 'case ' . $i);
        }
        // All or nothing: a valid op before an invalid one is not applied.
        self::assertFieldErrors(
            $this->sendOps($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 1]]), self::tiles($floor, 'ground', [[0, 0, 9]])]),
            ['ops.1.cells.0' => 'palette_index'],
        );
        self::assertSame([], $this->storedCells($map['id']));
        self::assertSame([], $this->storedRefs($map['id']));
    }

    public function testEnvelopeAndLimits(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor] = $this->scene();
        $path = '/maps/' . $map['id'] . '/ops';
        self::assertFieldErrors($gm->post($path, []), ['base_revision' => 'required', 'client_op_id' => 'required', 'ops' => 'required']);
        self::assertFieldErrors($gm->post($path, ['base_revision' => -1, 'client_op_id' => 'a b', 'ops' => 'x']), ['base_revision' => 'invalid', 'client_op_id' => 'invalid']);
        self::assertFieldErrors($gm->post($path, ['base_revision' => 1, 'client_op_id' => str_repeat('a', 41), 'ops' => []]), ['client_op_id' => 'invalid']);
        self::assertFieldErrors($gm->post($path, ['base_revision' => 1, 'client_op_id' => 'ok', 'ops' => ['a' => 1]]), ['ops' => 'invalid']);

        $many = array_fill(0, 201, ['type' => 'map.meta', 'theme' => 'dark']);
        self::assertFieldErrors($this->sendOps($gm, $map['id'], $many), ['ops' => 'too_many']);
        $this->opsOk($gm, $map['id'], array_fill(0, 200, ['type' => 'map.meta', 'theme' => 'dark']));

        $cells = [];
        for ($i = 0; $i < 5001; $i++) {
            $cells[] = [$i % 60, intdiv($i, 60) % 40, 1, 0, 0];
        }
        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::tiles($floor, 'ground', $cells)]), ['ops.0.cells' => 'too_many']);
        $result = $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', array_slice($cells, 0, 5000))]);
        self::assertSame(3, $result['revision']);
        self::assertSame(2400, array_sum($this->storedRefs($map['id'])), '5 000 writes on 60 x 40 cells');

        // Body > 1 MB: 413 before anything is read.
        $big = $gm->request('POST', $path, ['base_revision' => 3, 'client_op_id' => 'big', 'ops' => [], 'pad' => str_repeat('x', 1048576)]);
        self::assertSame(413, $big->status());

        // Empty lot: nothing changes.
        self::assertSame(['revision' => 3, 'applied' => 0, 'conflicts' => []], $this->opsOk($gm, $map['id'], []));
        self::assertSame(3, $this->revision($map['id']));
    }

    public function testIdempotence(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a] = $this->scene();
        $ops = [self::tiles($floor, 'ground', [[0, 0, 1], [1, 1, 1]])];
        $first = $this->sendOps($gm, $map['id'], $ops, 1, 'client-123');
        self::assertSame(200, $first->status());
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 0]])]);
        $replay = $this->sendOps($gm, $map['id'], $ops, 1, 'client-123');
        self::assertSame(200, $replay->status());
        self::assertSame(self::data($first), self::data($replay), 'same response');
        self::assertSame(['revision' => 2, 'applied' => 1, 'conflicts' => []], self::data($replay));
        self::assertSame(3, $this->revision($map['id']), 'not applied twice');
        self::assertSame([$floor . '|ground|1,1' => [1, 0, 0]], $this->storedCells($map['id']), 'the replay did not repaint 0,0');
        self::assertSame([(int) $a['id'] => 1], $this->storedRefs($map['id']));

        // The same id on another map or by another user is refused.
        $second = $this->newMap($gm, $map['game_id'], ['name' => 'Autre']);
        self::assertFieldErrors($this->sendOps($gm, $second['id'], [], 0, 'client-123'), ['client_op_id' => 'already_used']);
        $this->addMember($gm, $map['game_id'], 'Carol', 'co_gm');
        $coGm = $this->client('198.51.100.150');
        $coGm->login('Carol', self::PASSWORD);
        self::assertFieldErrors($this->sendOps($coGm, $map['id'], $ops, 1, 'client-123'), ['client_op_id' => 'already_used']);
        // Refused lots are not remembered: the same id can be sent again once fixed.
        self::assertSame(422, $this->sendOps($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 9]])], 3, 'retry-1')->status());
        self::assertSame(200, $this->sendOps($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 1]])], 3, 'retry-1')->status());
    }

    public function testMapMeta(): void
    {
        ['gm' => $gm, 'map' => $map] = $this->scene();
        $layers = array_reverse(self::data($gm->get('/maps/' . $map['id']))['layers']);
        $layers[0]['visible'] = false;
        $layers[1]['opacity'] = 0.25;
        $this->opsOk($gm, $map['id'], [[
            'type' => 'map.meta',
            'name' => 'Crypte oubliée',
            'grid' => ['cell_px' => 100, 'unit_label' => 'm', 'unit_per_cell' => 1.5],
            'layers' => $layers,
            'theme' => 'dark',
            'ambient' => ['darkness' => 0.85, 'tint' => '#223355', 'weather' => ['type' => 'rain']],
        ]]);
        $full = self::data($gm->get('/maps/' . $map['id']));
        self::assertSame('Crypte oubliée', $full['name']);
        self::assertSame(['type' => 'square', 'cell_px' => 100, 'width' => 60, 'height' => 40, 'unit_label' => 'm', 'unit_per_cell' => 1.5], $full['grid']);
        self::assertSame($layers, $full['layers']);
        self::assertSame('dark', $full['theme']);
        self::assertSame(['darkness' => 0.85, 'tint' => '#223355', 'time_of_day' => null, 'weather' => ['type' => 'rain', 'intensity' => 0]], $full['ambient']);
        self::assertSame(2, $full['revision']);

        $cases = [
            [['name' => ''], ['ops.0.name' => 'required']],
            [['grid' => ['width' => 401]], ['ops.0.grid.width' => 'too_large']],
            [['grid' => ['depth' => 1]], ['ops.0.grid' => 'invalid']],
            [['grid' => ['unit_label' => 'abcdefghijk']], ['ops.0.grid.unit_label' => 'too_long']],
            [['theme' => 'neon'], ['ops.0.theme' => 'invalid']],
            [['layers' => [['id' => 'ground', 'kind' => 'tiles']]], ['ops.0.layers' => 'invalid']],
            [['layers' => [['id' => 'ground', 'kind' => 'objects']]], ['ops.0.layers.0' => 'invalid']],
            [['layers' => [['id' => 'ground', 'kind' => 'tiles', 'opacity' => 2], ['id' => 'terrain', 'kind' => 'tiles'], ['id' => 'decor', 'kind' => 'tiles']]], ['ops.0.layers.0.opacity' => 'too_large']],
            [['layers' => [['id' => 'ground', 'kind' => 'tiles'], ['id' => 'ground', 'kind' => 'tiles']]], ['ops.0.layers.1' => 'invalid']],
            [['ambient' => ['darkness' => 2]], ['ops.0.ambient.darkness' => 'too_large']],
            [['ambient' => ['tint' => 'red']], ['ops.0.ambient.tint' => 'invalid']],
            [['ambient' => ['weather' => ['type' => 'acid']]], ['ops.0.ambient.weather.type' => 'invalid']],
            [['ambient' => ['fog' => 1]], ['ops.0.ambient' => 'invalid']],
        ];
        foreach ($cases as [$meta, $errors]) {
            self::assertFieldErrors($this->sendOps($gm, $map['id'], [['type' => 'map.meta'] + $meta]), $errors);
        }
        // Minimal layer stack (12.1 shorthand): defaults filled in.
        $this->opsOk($gm, $map['id'], [['type' => 'map.meta', 'layers' => [['id' => 'ground', 'kind' => 'tiles'], ['id' => 'terrain', 'kind' => 'tiles'], ['id' => 'decor', 'kind' => 'tiles']]]]);
        self::assertSame(['id' => 'terrain', 'kind' => 'tiles', 'visible' => true, 'locked' => false, 'opacity' => 1], self::data($gm->get('/maps/' . $map['id']))['layers'][1]);
    }

    public function testResizeNeedsTheCurrentRevisionAndShrinkClearsCells(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a, 'b' => $b] = $this->scene(['width' => 70, 'height' => 70]);
        $this->opsOk($gm, $map['id'], [
            self::tiles($floor, 'ground', [[0, 0, 1], [31, 31, 1], [32, 5, 2], [40, 40, 2], [69, 69, 1], [5, 64, 2]]),
            self::tiles($floor, 'decor', [[33, 0, 1]]),
        ]);
        // Stale base revision: 409, nothing changed.
        $r = $this->sendOps($gm, $map['id'], [['type' => 'map.meta', 'grid' => ['width' => 32]]], 1);
        self::assertSame(409, $r->status());
        self::assertSame('revision_conflict', self::errorCode($r));
        self::assertSame(70, self::data($gm->get('/maps/' . $map['id']))['grid']['width']);
        // Other meta changes do not need the current revision.
        self::assertSame(200, $this->sendOps($gm, $map['id'], [['type' => 'map.meta', 'theme' => 'slate']], 0)->status());

        $this->opsOk($gm, $map['id'], [['type' => 'map.meta', 'grid' => ['width' => 33, 'height' => 41]]]);
        self::assertSame([
            $floor . '|ground|0,0' => [1, 0, 0],
            $floor . '|ground|31,31' => [1, 0, 0],
            $floor . '|ground|32,5' => [2, 0, 0],
        ], $this->storedCells($map['id']));
        self::assertSame($this->recountRefs($map['id']), $this->storedRefs($map['id']));
        self::assertSame([(int) $a['id'] => 2, (int) $b['id'] => 1], $this->storedRefs($map['id']));
        // Growing back does not resurrect anything; cells outside are refused, then accepted.
        self::assertFieldErrors($this->sendOps($gm, $map['id'], [self::tiles($floor, 'ground', [[33, 0, 1]])]), ['ops.0.cells.0' => 'out_of_bounds']);
        $this->opsOk($gm, $map['id'], [['type' => 'map.meta', 'grid' => ['width' => 100, 'height' => 100]], self::tiles($floor, 'ground', [[99, 99, 2]])]);
        self::assertCount(4, $this->storedCells($map['id']));
        self::assertSame(['width' => 100, 'height' => 100], self::data($gm->get('/games/' . $map['game_id'] . '/maps'))[0]['grid']);
    }

    public function testRefsStayExactAfterRandomOps(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a, 'b' => $b] = $this->scene(['width' => 90, 'height' => 70]);
        $c = $this->uploadOk($gm, 'valid_webp_lossless.webp', ['kind' => 'tile']);
        // Index 3 = asset a again (two indexes, one asset), index 4 = c.
        $this->opsOk($gm, $map['id'], [self::paletteAdd(3, $a['id']), self::paletteAdd(4, $c['id'])]);
        mt_srand(4242);
        $expected = [];
        $width = 90;
        $height = 70;
        for ($lot = 0; $lot < 25; $lot++) {
            $ops = [];
            if ($lot === 12) {
                // Shrink in the middle of the sequence: the cells left outside disappear.
                $width = 50;
                $height = 45;
                $ops[] = ['type' => 'map.meta', 'grid' => ['width' => $width, 'height' => $height]];
                foreach (array_keys($expected) as $key) {
                    [$x, $y] = array_map('intval', explode(',', substr($key, (int) strrpos($key, '|') + 1)));
                    if ($x >= $width || $y >= $height) {
                        unset($expected[$key]);
                    }
                }
            }
            for ($o = 0, $n = mt_rand(1, 4); $o < $n; $o++) {
                $layer = ['ground', 'terrain', 'decor'][mt_rand(0, 2)];
                $cells = [];
                for ($k = 0, $m = mt_rand(1, 300); $k < $m; $k++) {
                    $x = mt_rand(0, $width - 1);
                    $y = mt_rand(0, $height - 1);
                    $index = mt_rand(0, 3) === 0 ? 0 : mt_rand(1, 4);
                    $cell = [$x, $y, $index, $index === 0 ? 0 : mt_rand(0, 255), $index === 0 ? 0 : mt_rand(0, 15)];
                    $cells[] = $cell;
                    $key = $floor . '|' . $layer . '|' . $x . ',' . $y;
                    if ($index === 0) {
                        unset($expected[$key]);
                    } else {
                        $expected[$key] = [$cell[2], $cell[3], $cell[4]];
                    }
                }
                $ops[] = self::tiles($floor, $layer, $cells);
            }
            $this->opsOk($gm, $map['id'], $ops);
            self::assertSame($this->recountRefs($map['id']), $this->storedRefs($map['id']), 'lot ' . $lot);
        }
        ksort($expected);
        self::assertSame($expected, $this->storedCells($map['id']));
        self::assertSame(1 + 1 + 25, $this->revision($map['id']));
    }
}
