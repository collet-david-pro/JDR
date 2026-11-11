<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP4c;

/**
 * P14: world-aligned texture entries of the palette (`repeat` = block size in cells): palette.add
 * validation, change of the block size, presentation, export / import round trip.
 */
final class MapTexturePaletteTest extends MapsP4cTestCase
{
    public function testTextureAssetIsAcceptedWithItsRepeat(): void
    {
        $s = $this->scene();
        $tex = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => 'texture']);
        $this->opsOk($s['gm'], $s['map']['id'], [
            ['type' => 'palette.add', 'index' => 3, 'asset_id' => $tex['id'], 'repeat' => 4],
            self::tiles($s['floor'], 'ground', [[0, 0, 3], [1, 0, 3], [0, 0, 1]]),
        ]);
        $palette = self::data($s['gm']->get('/maps/' . $s['map']['id']))['palette'];
        self::assertSame(4, $palette[3]['repeat']);
        self::assertSame($tex['id'], $palette[3]['asset_id']);
        self::assertNull($palette[1]['repeat']);
        self::assertSame([(int) $s['a']['id'] => 1, (int) $tex['id'] => 1], $this->storedRefs($s['map']['id']));
    }

    public function testSoftEdgesFlagCanBeSetAndClearedOnAnExistingEntry(): void
    {
        $s = $this->scene();
        $id = $s['map']['id'];
        $this->opsOk($s['gm'], $id, [['type' => 'palette.add', 'index' => 1, 'asset_id' => $s['a']['id'], 'autotile' => 'soft']]);
        self::assertSame('soft', self::data($s['gm']->get('/maps/' . $id))['palette'][1]['autotile']);
        $this->opsOk($s['gm'], $id, [['type' => 'palette.add', 'index' => 1, 'asset_id' => $s['a']['id'], 'autotile' => 'none']]);
        self::assertNull(self::data($s['gm']->get('/maps/' . $id))['palette'][1]['autotile']);
        $this->opsOk($s['gm'], $id, [['type' => 'palette.add', 'index' => 1, 'asset_id' => $s['a']['id'], 'autotile' => 'soft']]);
        self::assertSame('soft', self::data($s['gm']->get('/maps/' . $id))['palette'][1]['autotile']);
    }

    public function testRepeatCanChangeOnlyForTheSameAsset(): void
    {
        $s = $this->scene();
        $tex = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => 'texture']);
        $this->opsOk($s['gm'], $s['map']['id'], [['type' => 'palette.add', 'index' => 3, 'asset_id' => $tex['id'], 'repeat' => 2]]);
        $this->opsOk($s['gm'], $s['map']['id'], [['type' => 'palette.add', 'index' => 3, 'asset_id' => $tex['id'], 'repeat' => 6]]);
        self::assertSame(6, self::data($s['gm']->get('/maps/' . $s['map']['id']))['palette'][3]['repeat']);
        // A tile entry never becomes a texture; another asset at the index is still a conflict.
        $this->opsOk($s['gm'], $s['map']['id'], [['type' => 'palette.add', 'index' => 1, 'asset_id' => $s['a']['id'], 'repeat' => 5]]);
        self::assertNull(self::data($s['gm']->get('/maps/' . $s['map']['id']))['palette'][1]['repeat']);
        self::assertSame(409, $this->sendOps($s['gm'], $s['map']['id'], [['type' => 'palette.add', 'index' => 3, 'asset_id' => $s['a']['id'], 'repeat' => 6]])->status());
    }

    public function testInvalidRepeatIsRefused(): void
    {
        $s = $this->scene();
        $tex = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => 'texture']);
        foreach ([0, 65, -1, 'x', 2.5, true] as $bad) {
            self::assertFieldErrors(
                $this->sendOps($s['gm'], $s['map']['id'], [['type' => 'palette.add', 'index' => 3, 'asset_id' => $tex['id'], 'repeat' => $bad]]),
                ['ops.0.repeat' => 'invalid'],
            );
        }
        self::assertCount(3, self::data($s['gm']->get('/maps/' . $s['map']['id']))['palette']);
    }

    public function testRepeatSurvivesExportAndImport(): void
    {
        $s = $this->scene();
        $tex = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => 'texture']);
        $this->opsOk($s['gm'], $s['map']['id'], [
            ['type' => 'palette.add', 'index' => 3, 'asset_id' => $tex['id'], 'repeat' => 8],
            self::tiles($s['floor'], 'ground', [[2, 2, 3]]),
        ]);
        $doc = $this->exportDoc($s['gm'], $s['map']['id']);
        self::assertSame(8, $doc['palette'][3]['repeat']);
        self::assertArrayNotHasKey('repeat', $doc['palette'][1]);

        $result = $this->importOk($s['gm'], $s['game']['id'], self::scratchFile((string) json_encode($doc)));
        self::assertSame(8, $result['map']['palette'][3]['repeat']);
        self::assertNull($result['map']['palette'][1]['repeat']);

        $doc['palette'][3]['repeat'] = 99;
        self::assertSame(422, $s['gm']->upload('/games/' . $s['game']['id'] . '/maps/import', self::scratchFile((string) json_encode($doc)), [], 'map.json')->status());
    }

    public function testZipRoundTripKeepsTextureKindAndCategory(): void
    {
        $s = $this->scene();
        $tex = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => 'texture']);
        $t = $this->db->t('asset_categories');
        $this->db->execute('INSERT INTO ' . $t . ' (`owner_user_id`, `parent_id`, `name`, `sort_order`) VALUES (?, NULL, ?, 0)', [$this->userId('Alice'), 'Sols de pierre']);
        $cat = (int) $this->db->lastInsertId();
        $this->db->execute('UPDATE ' . $this->db->t('assets') . ' SET `category_id` = ? WHERE `id` = ?', [$cat, (int) $tex['id']]);
        $this->opsOk($s['gm'], $s['map']['id'], [
            ['type' => 'palette.add', 'index' => 3, 'asset_id' => $tex['id'], 'repeat' => 4],
            self::tiles($s['floor'], 'ground', [[2, 2, 3]]),
        ]);
        $doc = $this->exportDoc($s['gm'], $s['map']['id']);
        self::assertSame('texture', $doc['palette'][3]['kind']);
        self::assertSame('Sols de pierre', $doc['palette'][3]['category']);
        self::assertSame('tile', $doc['palette'][1]['kind']);
        self::assertArrayNotHasKey('category', $doc['palette'][1]);

        $zip = self::scratchFile($s['gm']->get('/maps/' . $s['map']['id'] . '/export?assets=1')->contents(), '.zip');
        $bob = $this->user('Bob');
        $game = $this->newGame($bob, 'Autre table');
        $result = $this->importOk($bob, $game['id'], $zip);
        $row = $this->db->fetchOne(
            'SELECT a.`kind`, c.`name` AS `category` FROM ' . $this->db->t('assets') . ' a LEFT JOIN ' . $t . ' c ON c.`id` = a.`category_id` WHERE a.`id` = ?',
            [(int) $result['map']['palette'][3]['asset_id']],
        );
        self::assertSame('texture', $row['kind']);
        self::assertSame('Sols de pierre', $row['category']);
        self::assertSame(4, $result['map']['palette'][3]['repeat']);
        $tile = $this->db->fetchValue('SELECT `kind` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $result['map']['palette'][1]['asset_id']]);
        self::assertSame('tile', $tile);
    }

    public function testDocumentWithAnInvalidPaletteKindIsRefused(): void
    {
        $s = $this->scene();
        $doc = $this->exportDoc($s['gm'], $s['map']['id']);
        $doc['palette'][1]['kind'] = 'object';
        self::assertSame(422, $s['gm']->upload('/games/' . $s['game']['id'] . '/maps/import', self::scratchFile((string) json_encode($doc)), [], 'map.json')->status());
    }

    public function testPaletteRefusesAnImageThatIsNeitherTileNorTexture(): void
    {
        $s = $this->scene();
        foreach (['object', 'token', 'background'] as $i => $kind) {
            $asset = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => $kind, 'name' => 'x' . $i]);
            self::assertFieldErrors(
                $this->sendOps($s['gm'], $s['map']['id'], [['type' => 'palette.add', 'index' => 3, 'asset_id' => $asset['id']]]),
                ['ops.0.asset_id' => 'not_paintable'],
            );
            $this->db->execute('DELETE FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $asset['id']]);
        }
        self::assertCount(3, self::data($s['gm']->get('/maps/' . $s['map']['id']))['palette']);
    }
}
