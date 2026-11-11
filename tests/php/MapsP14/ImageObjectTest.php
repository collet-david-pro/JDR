<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP14;

use JDR\Domain\Integrity\IntegrityScanner;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\MapsP4c\MapsP4cTestCase;

/**
 * P14: image objects of a map (background or free picture): validation, asset rights and kinds,
 * map_asset_refs (one per image), the "images" list of the map, export / import, versions,
 * duplication, templates, floor removal and map shrink. The gm-layer leak check is in LeakTest.
 */
final class ImageObjectTest extends MapsP4cTestCase
{
    /**
     * @return array{gm: ApiClient, game: array<string, mixed>, map: array<string, mixed>, floor: string, bg: array<string, mixed>, obj: array<string, mixed>, tile: array<string, mixed>}
     */
    private function world(): array
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        $bg = $this->uploadOk($gm, 'valid_webp_lossy.webp', ['kind' => 'background']);
        $obj = $this->uploadOk($gm, 'valid_jpeg_exif_orientation6.jpg', ['kind' => 'object']);
        $tile = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);

        return ['gm' => $gm, 'game' => $game, 'map' => $map, 'floor' => (string) $map['floors'][0]['id'], 'bg' => $bg, 'obj' => $obj, 'tile' => $tile];
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    private static function image(string $uid, string $floor, string $assetId, array $over = []): array
    {
        return array_replace_recursive([
            'uid' => $uid, 'floor' => $floor, 'type' => 'image', 'layer' => 'props',
            'geometry' => ['x' => 0, 'y' => 0, 'w' => 10, 'h' => 8, 'rotation' => 0],
            'props' => ['asset_id' => $assetId, 'opacity' => 1, 'flip_h' => false, 'flip_v' => false, 'placement' => 'background'],
            'visibility' => 'all', 'locked' => true, 'sort_order' => 0,
        ], $over);
    }

    /**
     * @param array<string, mixed> $object
     * @return list<array<string, mixed>>
     */
    private static function add(array $object): array
    {
        return [['type' => 'object.add', 'object' => $object]];
    }

    public function testValidationAndAssetRules(): void
    {
        $w = $this->world();
        $f = $w['floor'];
        $id = (string) $w['bg']['id'];
        $cases = [
            [['geometry' => ['w' => 0]], ['ops.0.object.geometry.w' => 'too_small']],
            [['geometry' => ['w' => 121]], ['ops.0.object.geometry.w' => 'too_large']],
            [['geometry' => ['x' => 61]], ['ops.0.object.geometry.x' => 'too_large']],
            [['geometry' => ['x' => -10, 'w' => 10]], ['ops.0.object.geometry' => 'out_of_bounds']],
            [['geometry' => ['rotation' => 400]], ['ops.0.object.geometry.rotation' => 'too_large']],
            [['geometry' => ['rotation' => 'a']], ['ops.0.object.geometry.rotation' => 'invalid']],
            [['props' => ['opacity' => 1.5]], ['ops.0.object.props.opacity' => 'too_large']],
            [['props' => ['placement' => 'under']], ['ops.0.object.props.placement' => 'invalid']],
            [['props' => ['flip_h' => 1]], ['ops.0.object.props.flip_h' => 'invalid']],
            [['props' => ['asset_id' => 'abc']], ['ops.0.object.props.asset_id' => 'invalid']],
            [['props' => ['asset_id' => '999999']], ['ops.0.object.props.asset_id' => 'not_found']],
            [['props' => ['asset_id' => (string) $w['tile']['id']]], ['ops.0.object.props.asset_id' => 'not_found']],
        ];
        foreach ($cases as [$over, $errors]) {
            self::assertFieldErrors($this->sendOps($w['gm'], $w['map']['id'], self::add(self::image('i1', $f, $id, $over))), $errors);
        }
        $noFlip = self::image('i1', $f, $id);
        unset($noFlip['props']['flip_v']);
        self::assertFieldErrors($this->sendOps($w['gm'], $w['map']['id'], self::add($noFlip)), ['ops.0.object.props.flip_v' => 'required']);
        $extra = self::image('i1', $f, $id, ['props' => ['blocks_vision' => true]]);
        self::assertFieldErrors($this->sendOps($w['gm'], $w['map']['id'], self::add($extra)), ['ops.0.object.props' => 'invalid']);

        // The personal asset of another account, not used by the game: refused.
        $bob = $this->user('Bob');
        $foreign = $this->uploadOk($bob, 'valid_png_transparent.png', ['kind' => 'object']);
        self::assertFieldErrors(
            $this->sendOps($w['gm'], $w['map']['id'], self::add(self::image('i1', $f, (string) $foreign['id']))),
            ['ops.0.object.props.asset_id' => 'not_found'],
        );
        self::assertSame([], $this->storedRefs($w['map']['id']), 'refused lots change nothing');
    }

    public function testTilesOfABigPicture(): void
    {
        $w = $this->world();
        $f = $w['floor'];
        $id = (string) $w['bg']['id'];
        $tile = ['group' => 'bigmap_1', 'x' => 4095, 'y' => 0, 'w' => 3000, 'h' => 4096, 'tw' => 7095, 'th' => 4096];
        $bad = [
            [['group' => 'a b'] + $tile, 'group'],
            [['x' => -1] + $tile, 'x'],
            [['w' => 3001] + $tile, ''],
            [['h' => 1.5] + $tile, 'h'],
            [['tw' => 0] + $tile, 'tw'],
        ];
        foreach ($bad as [$t, $key]) {
            self::assertFieldErrors(
                $this->sendOps($w['gm'], $w['map']['id'], self::add(self::image('t1', $f, $id, ['props' => ['tile' => $t]]))),
                ['ops.0.object.props.tile' . ($key === '' ? '' : '.' . $key) => 'invalid'],
            );
        }
        $partial = $tile;
        unset($partial['th']);
        self::assertFieldErrors(
            $this->sendOps($w['gm'], $w['map']['id'], self::add(self::image('t1', $f, $id, ['props' => ['tile' => $partial]]))),
            ['ops.0.object.props.tile' => 'invalid'],
        );
        $this->opsOk($w['gm'], $w['map']['id'], self::add(self::image('t1', $f, $id, ['props' => ['tile' => $tile]])));
        $full = self::data($w['gm']->get('/maps/' . $w['map']['id']));
        $objects = array_column($full['objects'], null, 'uid');
        self::assertEquals($tile, $objects['t1']['props']['tile']);
        self::assertArrayNotHasKey('tile', self::image('t2', $f, $id)['props'], 'a one-piece image has no tile');
    }

    public function testRefsFollowTheImagesAndTheMapListsTheirUrls(): void
    {
        $w = $this->world();
        $f = $w['floor'];
        $bg = (int) $w['bg']['id'];
        $obj = (int) $w['obj']['id'];
        $this->opsOk($w['gm'], $w['map']['id'], [
            ...self::add(self::image('bg1', $f, (string) $bg, ['geometry' => ['rotation' => -90]])),
            ...self::add(self::image('pic', $f, (string) $obj, ['layer' => 'gm', 'geometry' => ['x' => 2.5, 'y' => 3, 'w' => 1.25, 'h' => 1], 'props' => ['placement' => 'above', 'opacity' => 0.5]])),
            ...self::add(self::image('pic2', $f, (string) $obj, ['geometry' => ['x' => 5, 'y' => 5, 'w' => 1, 'h' => 1]])),
        ]);
        self::assertSame([$bg => 1, $obj => 2], $this->storedRefs($w['map']['id']));
        $full = self::data($w['gm']->get('/maps/' . $w['map']['id']));
        $objects = array_column($full['objects'], null, 'uid');
        self::assertSame(['x' => 0, 'y' => 0, 'w' => 10, 'h' => 8, 'rotation' => 270], $objects['bg1']['geometry'], 'rotation normalized');
        self::assertSame(['asset_id' => (string) $obj, 'opacity' => 0.5, 'flip_h' => false, 'flip_v' => false, 'placement' => 'above'], $objects['pic']['props']);
        self::assertSame([(string) $bg, (string) $obj], array_column($full['images'], 'asset_id'));
        self::assertStringContainsString('/files/' . $w['bg']['uuid'], (string) $full['images'][0]['url']);
        self::assertSame((int) $w['bg']['width'], $full['images'][0]['width']);

        // Update: move (no asset check), change the asset (refs move), remove.
        $this->opsOk($w['gm'], $w['map']['id'], [['type' => 'object.update', 'uid' => 'pic2', 'rev' => 1, 'patch' => [
            'geometry' => ['x' => 1, 'y' => 1, 'w' => 2, 'h' => 2, 'rotation' => 45],
            'props' => ['asset_id' => (string) $bg, 'opacity' => 1, 'flip_h' => true, 'flip_v' => false, 'placement' => 'above'],
        ]]]);
        self::assertSame([$bg => 2, $obj => 1], $this->storedRefs($w['map']['id']));
        self::assertFieldErrors($this->sendOps($w['gm'], $w['map']['id'], [['type' => 'object.update', 'uid' => 'pic2', 'rev' => 2, 'patch' => [
            'props' => ['asset_id' => (string) $w['tile']['id'], 'opacity' => 1, 'flip_h' => true, 'flip_v' => false, 'placement' => 'above'],
        ]]]), ['ops.0.patch.props.asset_id' => 'not_found']);
        $this->opsOk($w['gm'], $w['map']['id'], [['type' => 'object.remove', 'uid' => 'pic']]);
        self::assertSame([$bg => 2], $this->storedRefs($w['map']['id']));
        self::assertSame($this->storedRefs($w['map']['id']), $this->integrityRefs($w['map']['id']), 'integrity check agrees');

        // Shrink: an image that no longer fits goes with its reference; floor removal releases the rest.
        $this->opsOk($w['gm'], $w['map']['id'], [['type' => 'map.meta', 'grid' => ['width' => 4, 'height' => 4]]]);
        self::assertSame([$bg => 1], $this->storedRefs($w['map']['id']), 'bg1 (10 x 8 > 2 x map) left with the shrink');
        $this->opsOk($w['gm'], $w['map']['id'], [['type' => 'map.meta', 'grid' => ['width' => 60, 'height' => 40]]]);
        $this->opsOk($w['gm'], $w['map']['id'], [
            ['type' => 'floor.add', 'floor' => ['uid' => 'cave', 'name' => 'Grotte', 'level' => -1]],
            ...self::add(self::image('deep', 'cave', (string) $obj)),
        ]);
        self::assertSame([$bg => 1, $obj => 1], $this->storedRefs($w['map']['id']));
        $this->opsOk($w['gm'], $w['map']['id'], [['type' => 'floor.remove', 'uid' => 'cave']]);
        self::assertSame([$bg => 1], $this->storedRefs($w['map']['id']));
    }

    public function testExportImportVersionsDuplicateAndTemplates(): void
    {
        $w = $this->world();
        $f = $w['floor'];
        $bg = (int) $w['bg']['id'];
        $mapId = (string) $w['map']['id'];
        $this->opsOk($w['gm'], $mapId, self::add(self::image('bg1', $f, (string) $bg)));

        // Export: the hash, never the id.
        $doc = $this->exportDoc($w['gm'], $mapId);
        $image = array_values(array_filter($doc['objects'], static fn (array $o): bool => $o['type'] === 'image'))[0];
        self::assertNull($image['props']['asset_id']);
        self::assertMatchesRegularExpression('/^sha256:[0-9a-f]{64}$/', $image['asset']);

        // Import by the owner: found again by hash; by another GM without the file: left out, listed missing.
        $json = json_encode($doc, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        $imported = $this->importOk($w['gm'], $w['game']['id'], self::scratchFile($json));
        self::assertSame([$bg => 1], $this->storedRefs((string) $imported['map']['id']));
        self::assertSame((string) $bg, array_column($imported['map']['objects'], null, 'uid')['bg1']['props']['asset_id']);
        $carol = $this->user('Carol');
        $other = $this->newGame($carol);
        $alone = $this->importOk($carol, $other['id'], self::scratchFile($json));
        self::assertSame([], array_values(array_filter($alone['map']['objects'], static fn (array $o): bool => $o['type'] === 'image')));
        self::assertContains($image['asset'], array_column($alone['missing_assets'], 'ref'));
        $broken = $doc;
        unset($broken['objects'][0]['asset']);
        self::assertFieldErrors($this->import($w['gm'], $w['game']['id'], self::scratchFile(json_encode($broken, JSON_THROW_ON_ERROR))), ['objects.0.asset' => 'required']);

        // ZIP export / import into another account: the image file travels with the map.
        $zip = self::scratchFile($w['gm']->get('/maps/' . $mapId . '/export?assets=1')->contents(), '.zip');
        $fromZip = $this->importOk($carol, $other['id'], $zip);
        $copied = array_column($fromZip['map']['objects'], null, 'uid')['bg1'] ?? null;
        self::assertNotNull($copied, 'image kept through the ZIP');
        self::assertNotSame((string) $bg, $copied['props']['asset_id'], 'an asset of the importer');
        self::assertSame('object', (string) $this->db->fetchValue('SELECT `kind` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $copied['props']['asset_id']]));

        // Versions: remove the image, restore the snapshot.
        $version = self::data($w['gm']->post('/maps/' . $mapId . '/versions', ['label' => 'Avec fond']));
        $this->opsOk($w['gm'], $mapId, [['type' => 'object.remove', 'uid' => 'bg1']]);
        self::assertSame([], $this->storedRefs($mapId));
        self::assertSame(200, $w['gm']->post('/maps/' . $mapId . '/versions/' . $version['id'] . '/restore', [])->status());
        self::assertSame([$bg => 1], $this->storedRefs($mapId));
        self::assertSame((string) $bg, array_column(self::data($w['gm']->get('/maps/' . $mapId))['objects'], null, 'uid')['bg1']['props']['asset_id']);

        // Duplication and templates copy the image and its reference.
        $copy = self::data($w['gm']->post('/maps/' . $mapId . '/duplicate', []));
        self::assertSame([$bg => 1], $this->storedRefs((string) $copy['id']));
        $template = self::data($w['gm']->post('/maps/' . $mapId . '/save-as-template', ['name' => 'Fond']));
        self::assertSame([$bg => 1], $this->storedRefs((string) $template['id']));
        $fromTemplate = self::data($w['gm']->post('/templates/' . $template['id'] . '/instantiate', ['game_id' => (int) $w['game']['id']]));
        self::assertSame([$bg => 1], $this->storedRefs((string) $fromTemplate['id']));
        self::assertSame($this->storedRefs((string) $fromTemplate['id']), $this->integrityRefs((string) $fromTemplate['id']));
    }

    public function testPlayersAndOutsiders(): void
    {
        $w = $this->world();
        $this->addMember($w['gm'], $w['game']['id'], 'Bob');
        $bob = $this->login('Bob');
        self::assertSame(403, $this->sendOps($bob, $w['map']['id'], self::add(self::image('i1', $w['floor'], (string) $w['bg']['id'])))->status());
        $dave = $this->user('Dave');
        self::assertSame(404, $this->sendOps($dave, $w['map']['id'], self::add(self::image('i1', $w['floor'], (string) $w['bg']['id'])))->status());
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

    private function login(string $username): ApiClient
    {
        $client = $this->client('198.51.100.77');
        $client->login($username, self::PASSWORD);

        return $client;
    }
}
