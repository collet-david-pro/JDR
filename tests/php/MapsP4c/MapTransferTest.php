<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP4c;

use JDR\Maps\ChunkCodec;
use JDR\Zip\ZipReader;

/**
 * GET /maps/{id}/export and POST /games/{id}/maps/import (contract P4c, projet.md 12.1).
 */
final class MapTransferTest extends MapsP4cTestCase
{
    /**
     * A painted map on two layers with three palette slots (the third one never painted).
     *
     * @return array<string, mixed>
     */
    private function paintedScene(): array
    {
        $s = $this->scene(['width' => 70, 'height' => 45, 'theme' => 'slate']);
        $c = $this->uploadOk($s['gm'], 'valid_webp_lossless.webp', ['kind' => 'tile']);
        $cells = [];
        for ($x = 0; $x < 70; $x += 3) {
            $cells[] = [$x, $x % 45, 1 + ($x % 2), $x % 5, $x % 16];
        }
        $this->opsOk($s['gm'], $s['map']['id'], [
            ['type' => 'palette.add', 'index' => 3, 'asset_id' => $c['id'], 'autotile' => 'wall-a'],
            self::tiles($s['floor'], 'ground', $cells),
            self::tiles($s['floor'], 'decor', [[69, 44, 2, 7, 15], [33, 33, 1]]),
            ['type' => 'map.meta', 'ambient' => ['darkness' => 0.4, 'tint' => '#112233', 'weather' => ['type' => 'rain', 'intensity' => 0.5]],
                'layers' => [
                    ['id' => 'ground', 'kind' => 'tiles', 'visible' => true, 'locked' => true, 'opacity' => 0.5],
                    ['id' => 'terrain', 'kind' => 'tiles'], ['id' => 'decor', 'kind' => 'tiles', 'visible' => false],
                    ['id' => 'gm', 'kind' => 'objects', 'gm_only' => true],
                ]],
        ]);
        $s['c'] = $c;

        return $s;
    }

    public function testExportedDocumentFollowsTheFormat(): void
    {
        $s = $this->paintedScene();
        $doc = $this->exportDoc($s['gm'], $s['map']['id']);

        self::assertSame(
            ['format', 'format_version', 'app_version', 'name', 'kind', 'grid', 'theme', 'ambient', 'palette', 'layers', 'floors',
                'chunks', 'fog', 'objects', 'notes', 'links', 'tokens_placed', 'generation'],
            array_keys($doc),
        );
        self::assertSame('jdr-map', $doc['format']);
        self::assertSame(1, $doc['format_version']);
        self::assertSame(['type' => 'square', 'cell_px' => 70, 'width' => 70, 'height' => 45, 'unit_label' => 'ft', 'unit_per_cell' => 5], $doc['grid']);
        self::assertSame('slate', $doc['theme']);
        self::assertSame('rain', $doc['ambient']['weather']['type']);
        self::assertNull($doc['palette'][0]);
        $sha = (string) $this->db->fetchValue('SELECT `sha256` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $s['a']['id']]);
        self::assertSame(['asset' => 'sha256:' . $sha, 'name' => $s['a']['name'], 'autotile' => null], $doc['palette'][1]);
        self::assertSame('wall-a', $doc['palette'][3]['autotile']);
        self::assertArrayNotHasKey('asset_id', $doc['palette'][1]);
        self::assertSame([['uid' => 'f1', 'level' => 0, 'name' => 'Rez-de-chaussée']], $doc['floors']);
        self::assertSame(['ground', 'decor'], array_keys($doc['chunks']['f1']));
        self::assertSame([], $doc['objects']);
        self::assertSame([], $doc['fog']);
        self::assertNull($doc['generation']);
        self::assertStringContainsString('attachment; filename="Crypte.json"', (string) $s['gm']->get('/maps/' . $s['map']['id'] . '/export?assets=0')->header('Content-Disposition'));
        // Cells = what the ops painted.
        self::assertSame(count($this->storedCells($s['map']['id'])), count(self::docCells($doc)));
        self::assertSame(422, $s['gm']->get('/maps/' . $s['map']['id'] . '/export?assets=2')->status());
    }

    public function testExportImportRoundTripKeepsTheContent(): void
    {
        $s = $this->paintedScene();
        $doc = $this->exportDoc($s['gm'], $s['map']['id']);
        $result = $this->importOk($s['gm'], $s['game']['id'], self::scratchFile((string) json_encode($doc)));

        self::assertSame([], $result['missing_assets']);
        $copy = $result['map'];
        self::assertNotSame($s['map']['id'], $copy['id']);
        self::assertSame(0, $copy['revision']);
        $source = self::data($s['gm']->get('/maps/' . $s['map']['id']));
        foreach (['name', 'kind', 'grid', 'theme', 'ambient', 'layers', 'format_version'] as $key) {
            self::assertSame($source[$key], $copy[$key], $key);
        }
        self::assertSame(array_column($source['palette'], 'asset_id'), array_column($copy['palette'], 'asset_id'));
        self::assertSame(array_column($source['palette'], 'autotile'), array_column($copy['palette'], 'autotile'));
        self::assertSame(array_values($this->storedCells($s['map']['id'])), array_values($this->storedCells($copy['id'])));
        self::assertSame($this->storedRefs($s['map']['id']), $this->storedRefs($copy['id']));
        self::assertSame($this->recountRefs($copy['id']), $this->storedRefs($copy['id']));
        // Export of the copy = export of the source (apart from the floor ids, never exported).
        $again = $this->exportDoc($s['gm'], $copy['id']);
        self::assertSame(self::docCells($doc), self::docCells($again));
        unset($doc['chunks'], $again['chunks']);
        self::assertSame($doc, $again);
        // The copy is editable like any map.
        $this->opsOk($s['gm'], $copy['id'], [self::tiles($copy['floors'][0]['id'], 'terrain', [[1, 1, 3]])]);
    }

    public function testFixtureV1ImportsAndExportsIdentically(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $fixture = self::fixtureDoc();
        $result = $this->importOk($gm, $game['id'], self::mapFixture('v1-sample.json'));

        // No asset of the fixture exists here: every reference is reported, indexes kept, empty.
        self::assertSame([
            ['ref' => $fixture['palette'][1]['asset'], 'name' => 'dalle_pierre_01'],
            ['ref' => $fixture['palette'][2]['asset'], 'name' => 'herbe'],
            ['ref' => $fixture['palette'][3]['asset'], 'name' => 'eau'],
        ], $result['missing_assets']);
        $map = $result['map'];
        self::assertSame([null, null, null, null], $map['palette']);
        self::assertSame('Crypte oubliée', $map['name']);
        self::assertSame(0.8, $map['layers'][1]['opacity']);
        self::assertSame([], $this->storedRefs($map['id']));

        $doc = $this->exportDoc($gm, $map['id']);
        self::assertSame(self::docCells($fixture), self::docCells($doc));
        self::assertSame(['generator', 'gen_version', 'seed', 'params'], array_keys($doc['generation']));
        self::assertEquals($fixture['generation'], $doc['generation']);
        foreach (['name', 'kind', 'grid', 'theme', 'ambient', 'layers', 'floors'] as $key) {
            self::assertSame($fixture[$key], $doc[$key], $key);
        }
        self::assertSame([null, null, null, null], $doc['palette']);
    }

    public function testJsonImportResolvesOwnAndGeneralAssets(): void
    {
        $gm = $this->user('Alice');
        $admin = $this->user('Root', 'admin');
        $game = $this->newGame($gm);
        $own = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $general = $this->uploadOk($admin, 'valid_png_transparent.png', ['kind' => 'tile', 'scope' => 'general']);
        $doc = self::fixtureDoc();
        $doc['palette'][1]['asset'] = 'sha256:' . $this->sha($own['id']);
        $doc['palette'][2]['asset'] = 'sha256:' . strtoupper($this->sha($general['id']));
        $used = $this->usedBytes('Alice');
        $result = $this->importOk($gm, $game['id'], self::scratchFile((string) json_encode($doc)));

        self::assertSame([['ref' => $doc['palette'][3]['asset'], 'name' => 'eau']], $result['missing_assets']);
        self::assertSame([$own['id'], $general['id']], [$result['map']['palette'][1]['asset_id'], $result['map']['palette'][2]['asset_id']]);
        self::assertSame('grass', $result['map']['palette'][2]['autotile']);
        self::assertNull($result['map']['palette'][3]);
        self::assertSame($this->recountRefsSkippingEmpty($result['map']['id']), $this->storedRefs($result['map']['id']));
        self::assertSame($used, $this->usedBytes('Alice'));
        self::assertSame(2, $this->rows('assets'));
    }

    public function testZipImportCreatesTheMissingAssetsThroughThePipeline(): void
    {
        $s = $this->paintedScene();
        $response = $s['gm']->get('/maps/' . $s['map']['id'] . '/export?assets=1');
        self::assertSame(200, $response->status());
        self::assertSame('application/zip', $response->header('Content-Type'));
        self::assertStringContainsString('filename="Crypte.zip"', (string) $response->header('Content-Disposition'));
        $zipPath = self::scratchFile($response->contents(), '.zip');
        $reader = new ZipReader($zipPath);
        $names = array_map(static fn ($e): string => $e->name, $reader->files());
        $reader->close();
        $shas = array_map(fn (array $a): string => $this->sha($a['id']), [$s['a'], $s['b'], $s['c']]);
        $expected = ['map.json'];
        foreach ([$s['a'], $s['b'], $s['c']] as $i => $asset) {
            $expected[] = 'assets/' . $shas[$i] . '.' . $this->db->fetchValue(
                'SELECT `ext` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?',
                [(int) $asset['id']],
            );
        }
        self::assertSame($expected, $names);

        // Bob has none of these assets: they are created for him (quota counted).
        $bob = $this->user('Bob');
        $game = $this->newGame($bob, 'Autre table');
        $result = $this->importOk($bob, $game['id'], $zipPath);
        self::assertSame([], $result['missing_assets']);
        $ids = array_column($result['map']['palette'], 'asset_id');
        self::assertCount(3, array_unique($ids));
        $rows = $this->db->fetchAll('SELECT `owner_user_id`, `kind`, `size_bytes`, `thumb_size_bytes` FROM ' . $this->db->t('assets') . ' WHERE `owner_user_id` = ?', [$this->userId('Bob')]);
        self::assertCount(3, $rows);
        self::assertSame(array_sum(array_map(static fn (array $r): int => (int) $r['size_bytes'] + (int) $r['thumb_size_bytes'], $rows)), $this->usedBytes('Bob'));
        self::assertSame(['tile'], array_values(array_unique(array_column($rows, 'kind'))));
        self::assertSame(array_values($this->storedCells($s['map']['id'])), array_values($this->storedCells($result['map']['id'])));
        self::assertSame($this->recountRefs($result['map']['id']), $this->storedRefs($result['map']['id']));
        self::assertTrue($this->integrity()['ok']);

        // A second import reuses them: nothing more consumed.
        $used = $this->usedBytes('Bob');
        $again = $this->importOk($bob, $game['id'], $zipPath);
        self::assertSame($ids, array_column($again['map']['palette'], 'asset_id'));
        self::assertSame($used, $this->usedBytes('Bob'));
    }

    public function testZipImportOverQuotaWritesNothing(): void
    {
        $s = $this->paintedScene();
        $zipPath = self::scratchFile($s['gm']->get('/maps/' . $s['map']['id'] . '/export?assets=1')->contents(), '.zip');
        $bob = $this->user('Bob');
        $game = $this->newGame($bob, 'Autre table');
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_quota_bytes` = 2000 WHERE `id` = ?', [$this->userId('Bob')]);
        $before = $this->counts();
        $assetFiles = self::storageFiles('assets');

        $response = $this->import($bob, $game['id'], $zipPath);
        self::assertSame(413, $response->status(), $response->body());
        self::assertSame('quota_exceeded', self::errorCode($response));
        self::assertSame($before, $this->counts());
        self::assertSame(0, $this->usedBytes('Bob'));
        self::assertSame($assetFiles, self::storageFiles('assets'));
    }

    public function testZipWithATrappedImageReportsItMissing(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $doc = self::fixtureDoc();
        $sha = substr($doc['palette'][1]['asset'], 7);
        $good = substr($doc['palette'][2]['asset'], 7);
        $zip = self::zipFile((string) json_encode($doc), [
            'assets/' . $sha . '.png' => self::fixture('trap_polyglot_png_php.png'),
            'assets/' . $good . '.png' => self::fixture('valid_png_opaque.png'),
            '__MACOSX/._x' => self::fixture('valid_png_opaque.png'),
        ]);
        $result = $this->importOk($gm, $game['id'], $zip);

        self::assertSame(['dalle_pierre_01', 'eau'], array_column($result['missing_assets'], 'name'));
        self::assertNull($result['map']['palette'][1]);
        self::assertNotNull($result['map']['palette'][2]);
        self::assertSame('herbe', $result['map']['palette'][2]['name']);
        self::assertSame(1, $this->rows('assets'));
        self::assertSame([], self::tmpLeftovers());
    }

    /**
     * @return iterable<string, array{0: \Closure(array<string, mixed>): array<string, mixed>, 1: string, 2: string}>
     */
    public static function trappedDocuments(): iterable
    {
        $chunk = static function (string $raw): string {
            return base64_encode((string) gzdeflate($raw, 6));
        };
        yield 'palette index out of bounds' => [static function (array $d) use ($chunk): array {
            $raw = ChunkCodec::emptyRaw('ground');
            ChunkCodec::setCell($raw, ChunkCodec::offset(1, 1), 9, 0, 0);
            $d['chunks']['f1']['ground']['0:0'] = $chunk($raw);

            return $d;
        }, 'chunks.f1.ground.0:0', 'bad_palette_index'];
        yield 'palette too large' => [static function (array $d): array {
            $d['palette'] = array_merge([null], array_fill(0, 4096, ['asset' => $d['palette'][1]['asset'], 'name' => 'x']));

            return $d;
        }, 'palette', 'too_many'];
        yield 'corrupt block' => [static function (array $d): array {
            $d['chunks']['f1']['ground']['0:0'] = base64_encode('not deflate at all');

            return $d;
        }, 'chunks.f1.ground.0:0', 'bad_compression'];
        yield 'deflate bomb' => [static function (array $d): array {
            $d['chunks']['f1']['ground']['0:0'] = base64_encode((string) gzdeflate(str_repeat("\0", 5000000), 9));

            return $d;
        }, 'chunks.f1.ground.0:0', 'bad_compression'];
        yield 'block of another layer' => [static function (array $d) use ($chunk): array {
            $d['chunks']['f1']['ground']['0:0'] = $chunk(ChunkCodec::emptyRaw('decor'));

            return $d;
        }, 'chunks.f1.ground.0:0', 'bad_layer'];
        yield 'cell painted outside the grid' => [static function (array $d) use ($chunk): array {
            $raw = ChunkCodec::emptyRaw('ground');
            ChunkCodec::setCell($raw, ChunkCodec::offset(31, 31), 1, 0, 0);
            $d['chunks']['f1']['ground']['1:1'] = $chunk($raw);

            return $d;
        }, 'chunks.f1.ground.1:1', 'out_of_bounds'];
        yield 'chunk outside the grid' => [static function (array $d) use ($chunk): array {
            $d['chunks']['f1']['ground']['5:0'] = $chunk(ChunkCodec::emptyRaw('ground'));

            return $d;
        }, 'chunks.f1.ground.5:0', 'out_of_bounds'];
        yield 'huge grid' => [static function (array $d): array {
            $d['grid']['width'] = 100000;

            return $d;
        }, 'grid.width', 'too_large'];
        yield 'future format' => [static function (array $d): array {
            $d['format_version'] = 2;

            return $d;
        }, 'format_version', 'unsupported'];
        yield 'prototype pollution' => [static function (array $d): array {
            $d['generation']['params']['__proto__'] = ['admin' => true];

            return $d;
        }, 'generation.params.__proto__', 'dangerous_key'];
        yield 'unknown key' => [static function (array $d): array {
            $d['script'] = '<script>alert(1)</script>';

            return $d;
        }, 'script', 'unsupported'];
        yield 'unknown floor' => [static function (array $d): array {
            $d['chunks']['f9'] = $d['chunks']['f1'];

            return $d;
        }, 'chunks.f9', 'not_found'];
        yield 'objects (P5)' => [static function (array $d): array {
            $d['objects'] = [['uid' => 'o1', 'type' => 'wall']];

            return $d;
        }, 'objects', 'unsupported'];
        yield 'bad asset reference' => [static function (array $d): array {
            $d['palette'][2]['asset'] = 'https://evil.example/x.png';

            return $d;
        }, 'palette.2.asset', 'invalid'];
        yield 'not a jdr map' => [static function (array $d): array {
            $d['format'] = 'other';

            return $d;
        }, 'format', 'invalid'];
    }

    /**
     * @param \Closure(array<string, mixed>): array<string, mixed> $trap
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('trappedDocuments')]
    public function testTrappedDocumentsAreRefusedWithoutWritingAnything(\Closure $trap, string $field, string $code): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $doc = $trap(self::fixtureDoc());
        $before = $this->counts();
        foreach ([self::scratchFile((string) json_encode($doc)), self::zipFile((string) json_encode($doc))] as $file) {
            $response = $this->import($gm, $game['id'], $file);
            self::assertSame(422, $response->status(), $response->body());
            self::assertSame($code === 'unsupported' && $field === 'format_version' ? 'unsupported_format_version' : 'validation_failed', self::errorCode($response));
            self::assertSame($code, $response->payload()['error']['fields'][$field] ?? null, $response->body());
            self::assertSame($before, $this->counts());
        }
        self::assertSame([], self::tmpLeftovers());
    }

    public function testInvalidFilesAreRefused(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $before = $this->counts();
        $noDocument = self::scratchFile('', '.zip');
        $writer = \JDR\Zip\ZipWriter::create($noDocument);
        $writer->addString('other.json', '{}');
        $writer->finish();
        $writer->close();
        $unsafe = self::scratchFile(\JDR\Tests\Assets\RawZip::build([['name' => '../map.json', 'data' => '{}']]), '.zip');
        $bomb = self::scratchFile(\JDR\Tests\Assets\RawZip::build([
            ['name' => 'map.json', 'data' => '{}', 'size' => 4000000000],
        ]), '.zip');
        foreach ([
            'not json' => self::scratchFile('{"format": "jdr-map", '),
            'a list' => self::scratchFile('[1, 2]'),
            'an image' => self::fixture('valid_png_opaque.png'),
            'zip without map.json' => $noDocument,
            'zip with an unsafe path' => $unsafe,
            'zip with a lying size' => $bomb,
            'empty file' => self::scratchFile(''),
        ] as $label => $file) {
            $response = $this->import($gm, $game['id'], $file);
            self::assertSame(422, $response->status(), $label . ' ' . $response->body());
            self::assertSame('invalid_map_file', self::errorCode($response), $label);
        }
        $response = $this->import($gm, $game['id'], self::scratchFile(str_repeat(' ', 16777217)));
        self::assertSame(413, $response->status());
        self::assertSame('file_too_large', self::errorCode($response));
        self::assertSame(['file' => 'required'], $gm->post('/games/' . $game['id'] . '/maps/import', [])->payload()['error']['fields']);
        self::assertSame($before, $this->counts());
    }

    public function testImportIsIdempotentByClientOpId(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $file = self::mapFixture('v1-sample.json');
        $first = $this->importOk($gm, $game['id'], $file, ['client_op_id' => 'import-1']);
        $second = $this->importOk($gm, $game['id'], $file, ['client_op_id' => 'import-1']);

        self::assertSame($first['map']['id'], $second['map']['id']);
        self::assertSame($first['missing_assets'], $second['missing_assets']);
        self::assertSame(1, $this->rows('maps'));
        $other = $this->user('Carol');
        $otherGame = $this->newGame($other);
        self::assertSame(['client_op_id' => 'already_used'], $this->import($other, $otherGame['id'], $file, ['client_op_id' => 'import-1'])->payload()['error']['fields']);
        self::assertSame(422, $this->import($gm, $game['id'], $file, ['client_op_id' => 'bad id!'])->status());
    }

    public function testPlayersAndStrangersCannotImportNorExport(): void
    {
        $s = $this->scene();
        $this->addMember($s['gm'], $s['game']['id'], 'Bob');
        $bob = $this->client('198.51.100.240');
        $bob->login('Bob', self::PASSWORD);
        $dave = $this->user('Dave');
        $file = self::mapFixture('v1-sample.json');

        self::assertSame(403, $this->import($bob, $s['game']['id'], $file)->status());
        self::assertSame(404, $this->import($dave, $s['game']['id'], $file)->status());
        self::assertSame(403, $bob->get('/maps/' . $s['map']['id'] . '/export?assets=1')->status());
        self::assertSame(404, $dave->get('/maps/' . $s['map']['id'] . '/export')->status());
        self::assertSame(404, $dave->get('/maps/' . $s['map']['id'] . '/export?assets=zz')->status());
        self::assertSame(1, $this->rows('maps'));
    }

    private function sha(string $assetId): string
    {
        return (string) $this->db->fetchValue('SELECT `sha256` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $assetId]);
    }

    /**
     * @return array<string, int>
     */
    private function counts(): array
    {
        $out = [];
        foreach (['maps', 'map_floors', 'map_chunks', 'map_asset_refs', 'assets', 'processed_ops', 'map_versions'] as $table) {
            $out[$table] = $this->rows($table);
        }

        return $out;
    }

    /**
     * map_asset_refs recount, ignoring the cells of empty palette slots.
     *
     * @return array<int, int>
     */
    private function recountRefsSkippingEmpty(string $mapId): array
    {
        $palette = json_decode((string) $this->db->fetchValue('SELECT `palette` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $mapId]), true);
        $counts = [];
        foreach ($this->storedCells($mapId) as [$index]) {
            if (isset($palette[$index]['asset_id'])) {
                $assetId = (int) $palette[$index]['asset_id'];
                $counts[$assetId] = ($counts[$assetId] ?? 0) + 1;
            }
        }
        ksort($counts);

        return $counts;
    }
}
