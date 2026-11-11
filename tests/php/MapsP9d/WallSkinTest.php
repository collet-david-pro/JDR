<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9d;

use JDR\Domain\Integrity\IntegrityScanner;
use JDR\Tests\MapsP4c\MapsP4cTestCase;

/**
 * Wall textures (props.texture_asset) and door images (asset_open / asset_closed): validation, asset
 * rights and kinds, map_asset_refs, the "images" list of the map, export / import, versions.
 */
final class WallSkinTest extends MapsP4cTestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function wall(string $uid, string $floor, ?string $texture): array
    {
        return [
            'uid' => $uid, 'floor' => $floor, 'type' => 'wall', 'layer' => 'walls',
            'geometry' => ['points' => [[1, 1], [6, 1]], 'closed' => false],
            'props' => ['kind' => 'stone', 'thickness' => 0.2, 'blocks_vision' => true, 'blocks_light' => true, 'blocks_move' => true, 'texture_asset' => $texture, 'height' => null],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function door(string $uid, string $floor, ?string $open, ?string $closed): array
    {
        return [
            'uid' => $uid, 'floor' => $floor, 'type' => 'door', 'layer' => 'walls',
            'geometry' => ['a' => [2, 2], 'b' => [3, 2]],
            'props' => ['state' => 'closed', 'locked' => false, 'secret' => false, 'asset_open' => $open, 'asset_closed' => $closed, 'swing' => 'a'],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ];
    }

    public function testValidationRefsAndImagesList(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        $mapId = (string) $map['id'];
        $f = (string) $map['floors'][0]['id'];
        $tex = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'texture']);
        $img = $this->uploadOk($gm, 'valid_jpeg_exif_orientation6.jpg', ['kind' => 'object']);
        $tile = $this->uploadOk($gm, 'valid_png_transparent.png', ['kind' => 'tile']);
        $texId = (int) $tex['id'];
        $imgId = (int) $img['id'];

        self::assertFieldErrors($this->sendOps($gm, $mapId, [['type' => 'object.add', 'object' => self::wall('w1', $f, 'abc')]]), ['ops.0.object.props.texture_asset' => 'invalid']);
        self::assertFieldErrors($this->sendOps($gm, $mapId, [['type' => 'object.add', 'object' => self::wall('w1', $f, '999999')]]), ['ops.0.object.props.texture_asset' => 'not_found']);
        self::assertFieldErrors($this->sendOps($gm, $mapId, [['type' => 'object.add', 'object' => self::wall('w1', $f, (string) $tile['id'])]]), ['ops.0.object.props.texture_asset' => 'not_found']);
        self::assertFieldErrors($this->sendOps($gm, $mapId, [['type' => 'object.add', 'object' => self::door('d1', $f, null, '999999')]]), ['ops.0.object.props.asset_closed' => 'not_found']);
        $bob = $this->user('Bob');
        $foreign = $this->uploadOk($bob, 'valid_png_transparent.png', ['kind' => 'object']);
        self::assertFieldErrors($this->sendOps($gm, $mapId, [['type' => 'object.add', 'object' => self::wall('w1', $f, (string) $foreign['id'])]]), ['ops.0.object.props.texture_asset' => 'not_found']);
        self::assertSame([], $this->storedRefs($mapId), 'refused lots change nothing');

        $this->opsOk($gm, $mapId, [
            ['type' => 'object.add', 'object' => self::wall('w1', $f, (string) $texId)],
            ['type' => 'object.add', 'object' => self::wall('w2', $f, (string) $texId)],
            ['type' => 'object.add', 'object' => self::wall('w3', $f, null)],
            ['type' => 'object.add', 'object' => self::door('d1', $f, (string) $imgId, (string) $texId)],
        ]);
        self::assertSame([$texId => 3, $imgId => 1], $this->storedRefs($mapId));
        $full = self::data($gm->get('/maps/' . $mapId));
        self::assertEqualsCanonicalizing([(string) $texId, (string) $imgId], array_column($full['images'], 'asset_id'));
        self::assertSame((string) $texId, array_column($full['objects'], null, 'uid')['w1']['props']['texture_asset']);

        // Changing / removing a texture moves the references (undo is the same ops reversed).
        $this->opsOk($gm, $mapId, [['type' => 'object.update', 'uid' => 'w2', 'rev' => 1, 'patch' => ['props' => self::wall('x', $f, null)['props']]]]);
        self::assertSame([$texId => 2, $imgId => 1], $this->storedRefs($mapId));
        $this->opsOk($gm, $mapId, [['type' => 'object.remove', 'uid' => 'd1']]);
        self::assertSame([$texId => 1], $this->storedRefs($mapId));
        self::assertSame($this->storedRefs($mapId), $this->integrityRefs($mapId), 'integrity check agrees');
    }

    public function testExportImportAndVersions(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        $mapId = (string) $map['id'];
        $f = (string) $map['floors'][0]['id'];
        $tex = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'texture']);
        $texId = (int) $tex['id'];
        $this->opsOk($gm, $mapId, [
            ['type' => 'object.add', 'object' => self::wall('w1', $f, (string) $texId)],
            ['type' => 'object.add', 'object' => self::door('d1', $f, null, (string) $texId)],
        ]);

        $doc = $this->exportDoc($gm, $mapId);
        $objects = array_column($doc['objects'], null, 'uid');
        self::assertNull($objects['w1']['props']['texture_asset'], 'ids mean nothing on another server');
        self::assertMatchesRegularExpression('/^sha256:[0-9a-f]{64}$/', $objects['w1']['assets']['texture_asset']);
        self::assertMatchesRegularExpression('/^sha256:[0-9a-f]{64}$/', $objects['d1']['assets']['asset_closed']);

        $json = json_encode($doc, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        $imported = $this->importOk($gm, $game['id'], self::scratchFile($json));
        self::assertSame([$texId => 2], $this->storedRefs((string) $imported['map']['id']));
        self::assertSame((string) $texId, array_column($imported['map']['objects'], null, 'uid')['w1']['props']['texture_asset']);

        // Another GM without the file: the wall stays, without its texture; the asset is listed missing.
        $carol = $this->user('Carol');
        $other = $this->newGame($carol);
        $alone = $this->importOk($carol, $other['id'], self::scratchFile($json));
        self::assertNull(array_column($alone['map']['objects'], null, 'uid')['w1']['props']['texture_asset']);
        self::assertContains($objects['w1']['assets']['texture_asset'], array_column($alone['missing_assets'], 'ref'));

        // A crafted id with no hash never reaches another account's asset.
        $crafted = $doc;
        foreach ($crafted['objects'] as &$o) {
            unset($o['assets']);
            if ($o['uid'] === 'w1') {
                $o['props']['texture_asset'] = (string) $texId;
            }
        }
        unset($o);
        $stolen = $this->importOk($carol, $other['id'], self::scratchFile(json_encode($crafted, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION)));
        self::assertNull(array_column($stolen['map']['objects'], null, 'uid')['w1']['props']['texture_asset']);

        // Versions: remove the wall, restore the snapshot.
        $version = self::data($gm->post('/maps/' . $mapId . '/versions', ['label' => 'Murs texturés']));
        $this->opsOk($gm, $mapId, [['type' => 'object.remove', 'uid' => 'w1'], ['type' => 'object.remove', 'uid' => 'd1']]);
        self::assertSame([], $this->storedRefs($mapId));
        self::assertSame(200, $gm->post('/maps/' . $mapId . '/versions/' . $version['id'] . '/restore', [])->status());
        self::assertSame([$texId => 2], $this->storedRefs($mapId));
    }

    /**
     * @return array<int, int>
     */
    private function integrityRefs(string $mapId): array
    {
        $refs = $this->app()->container()->get(IntegrityScanner::class)->expectedRefs((int) $mapId);
        ksort($refs);

        return $refs;
    }
}
