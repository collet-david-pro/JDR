<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Tests\Api\ApiClient;
use JDR\Zip\ZipReader;
use JDR\Zip\ZipWriter;

/**
 * Asset packs (ZIP) as background jobs: export, import, round trip, duplicates, errors per file,
 * dangerous archives, rights on jobs, cancellation.
 */
final class PacksApiTest extends AssetsTestCase
{
    public function testExportImportRoundTrip(): void
    {
        $alice = $this->userClient('Alice');
        $category = self::data($alice->post('/asset-categories', ['name' => 'Donjon']));
        $a = $this->uploadOk($alice, 'valid_png_opaque.png', ['kind' => 'tile', 'name' => 'Dalle', 'category_id' => $category['id']]);
        $alice->patch('/assets/' . $a['id'], ['tags' => ['pierre', 'sol']]);
        $this->uploadOk($alice, 'valid_gif_animated.gif', ['kind' => 'token', 'name' => 'Torche']);
        $this->uploadOk($alice, 'valid_webp_lossless.webp', ['kind' => 'object', 'name' => 'Coffre']);

        $start = $alice->post('/asset-packs/export', []);
        self::assertSame(202, $start->status(), $start->body());
        $job = $start->payload()['data']['job'];
        self::assertSame(['pack_export', 'pending'], [$job['type'], $job['status']]);
        self::assertSame(['done' => 0, 'total' => 3, 'percent' => 0], $job['progress']);
        self::assertArrayNotHasKey('state', $job['progress']);
        $job = $this->runJob($alice, $job['id']);
        self::assertSame('done', $job['status']);
        self::assertSame(100, $job['progress']['percent']);
        self::assertSame(3, $job['result']['count']);

        $download = $alice->get('/jobs/' . $job['id'] . '/download');
        self::assertSame(200, $download->status());
        self::assertSame('application/zip', $download->header('Content-Type'));
        self::assertStringStartsWith('attachment; filename="jdr-assets-', (string) $download->header('Content-Disposition'));
        $zip = self::storage() . '/export-copy.zip';
        file_put_contents($zip, $download->contents());
        $reader = new ZipReader($zip);
        $manifest = json_decode($reader->read($reader->find('pack.json'), 1 << 20), true);
        self::assertSame(['jdr-asset-pack', 1], [$manifest['format'], $manifest['version']]);
        self::assertCount(3, $manifest['assets']);
        $dalle = array_values(array_filter($manifest['assets'], static fn ($x) => $x['name'] === 'Dalle'))[0];
        self::assertSame(['tile', 'Donjon', ['pierre', 'sol']], [$dalle['kind'], $dalle['category'], $dalle['tags']]);
        self::assertSame(hash('sha256', $reader->read($reader->find($dalle['file']), 1 << 20)), $dalle['sha256']);
        $reader->close();

        // Import by another user: everything goes through the pipeline and the quota.
        $bob = $this->userClient('Bob', 'user', '203.0.113.11');
        $import = $bob->upload('/asset-packs/import', $zip);
        self::assertSame(202, $import->status(), $import->body());
        $job = $this->runJob($bob, $import->payload()['data']['job']['id']);
        self::assertSame('done', $job['status']);
        self::assertSame(['imported' => 3, 'duplicates' => 0, 'failed' => 0, 'errors' => []], array_intersect_key($job['result'], array_flip(['imported', 'duplicates', 'failed', 'errors'])));
        $bobAssets = self::data($bob->get('/assets'));
        self::assertCount(3, $bobAssets);
        self::assertSame(['pack'], array_values(array_unique(array_column($bobAssets, 'source'))));
        $dalleB = array_values(array_filter($bobAssets, static fn ($x) => $x['name'] === 'Dalle'))[0];
        self::assertSame(['pierre', 'sol'], array_column($dalleB['tags'], 'name'));
        self::assertSame('tile', $dalleB['kind']);
        self::assertNotNull($dalleB['category_id']);
        self::assertSame($this->usedBytes('Alice'), $this->usedBytes('Bob'));

        // Importing again: only duplicates, nothing consumed.
        $again = $this->runJob($bob, $bob->upload('/asset-packs/import', $zip)->payload()['data']['job']['id']);
        self::assertSame([0, 3], [$again['result']['imported'], $again['result']['duplicates']]);
        self::assertCount(3, self::data($bob->get('/assets')));
        self::assertTrue($this->integrity()['ok']);
        // Import archives are deleted once done; only the export archive (downloadable) remains.
        self::assertCount(1, glob(self::storage() . '/jobs/*.zip') ?: []);
        self::assertSame([], self::tmpLeftovers());
    }

    public function testImportWithoutManifestAndErrorsPerFile(): void
    {
        $zip = self::storage() . '/plain.zip';
        $writer = ZipWriter::create($zip);
        $writer->addFile('images/Mur_gris.png', self::fixture('valid_png_opaque.png'));
        $writer->addFile('images/piege.png', self::fixture('trap_polyglot_png_php.png'));
        $writer->addFile('images/bombe.png', self::fixture('trap_png_bomb_50000.png'));
        $writer->addFile('images/torche.gif', self::fixture('valid_gif_animated.gif'));
        $writer->addString('readme.txt', 'ignored');
        $writer->finish();

        $alice = $this->userClient('Alice');
        $job = $this->runJob($alice, $alice->upload('/asset-packs/import', $zip)->payload()['data']['job']['id']);
        self::assertSame('done', $job['status']);
        self::assertSame(2, $job['result']['imported']);
        self::assertSame(2, $job['result']['failed']);
        self::assertSame([
            ['file' => 'images/piege.png', 'code' => 'unsupported_type'],
            ['file' => 'images/bombe.png', 'code' => 'image_too_large'],
        ], $job['result']['errors']);
        self::assertContains('Mur gris', array_column(self::data($alice->get('/assets')), 'name'));
        self::assertSame([], self::tmpLeftovers());
        self::assertTrue($this->integrity()['ok']);
    }

    public function testQuotaIsAppliedPerFile(): void
    {
        $zip = self::storage() . '/two.zip';
        $writer = ZipWriter::create($zip);
        $writer->addFile('a.png', self::fixture('valid_png_opaque.png'));
        $writer->addFile('b.png', self::fixture('valid_png_transparent.png'));
        $writer->finish();
        $alice = $this->userClient('Alice');
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_quota_bytes` = 10 WHERE `username` = ?', ['Alice']);
        $job = $this->runJob($alice, $alice->upload('/asset-packs/import', $zip)->payload()['data']['job']['id']);
        self::assertSame(['quota_exceeded', 'quota_exceeded'], array_column($job['result']['errors'], 'code'));
        self::assertSame(0, $this->usedBytes('Alice'));
    }

    /**
     * @return array<string, array{0: list<array<string, mixed>>}>
     */
    public static function dangerousArchives(): array
    {
        return [
            'zip slip' => [[['name' => '../../../index.php', 'data' => '<?php echo 1;']]],
            'symlink' => [[['name' => 'a.png', 'data' => '/etc/passwd', 'attr' => 0120777 << 16]]],
            'bad manifest' => [[['name' => 'pack.json', 'data' => '{"format":"other"}']]],
            'manifest pointing outside' => [[['name' => 'pack.json', 'data' => '{"format":"jdr-asset-pack","version":1,"assets":[{"file":"../x.png"}]}']]],
            'no image' => [[['name' => 'readme.txt', 'data' => 'hello']]],
        ];
    }

    /**
     * @dataProvider dangerousArchives
     * @param list<array<string, mixed>> $entries
     */
    public function testDangerousArchivesAreRefused(array $entries): void
    {
        $zip = self::storage() . '/bad.zip';
        file_put_contents($zip, RawZip::build($entries));
        $alice = $this->userClient('Alice');
        $response = $alice->upload('/asset-packs/import', $zip);
        self::assertSame(422, $response->status(), $response->body());
        self::assertSame('invalid_pack', self::errorCode($response));
        self::assertSame(0, $this->rows('background_jobs'));
        self::assertSame([], glob(self::storage() . '/jobs/*') ?: []);
        self::assertFileDoesNotExist(self::$root . '/index.php');
    }

    public function testNotAZipIsRefused(): void
    {
        $alice = $this->userClient('Alice');
        $response = $alice->upload('/asset-packs/import', self::fixture('valid_png_opaque.png'));
        self::assertSame('invalid_pack', self::errorCode($response));
    }

    public function testJobsBelongToTheirCreator(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $job = $alice->post('/asset-packs/export', ['asset_ids' => [$asset['id']]])->payload()['data']['job'];
        $bob = $this->userClient('Bob', 'user', '203.0.113.11');
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        foreach ([$bob, $admin] as $other) {
            self::assertSame(404, $other->get('/jobs/' . $job['id'])->status());
            self::assertSame(404, $other->post('/jobs/' . $job['id'] . '/step')->status());
            self::assertSame(404, $other->post('/jobs/' . $job['id'] . '/cancel')->status());
            self::assertSame(404, $other->get('/jobs/' . $job['id'] . '/download')->status());
        }
        // Download before the end, then cancellation.
        self::assertSame(422, $alice->get('/jobs/' . $job['id'] . '/download')->status());
        $cancelled = self::data($alice->post('/jobs/' . $job['id'] . '/cancel'))['job'];
        self::assertSame('cancelled', $cancelled['status']);
        self::assertSame('cancelled', self::data($alice->post('/jobs/' . $job['id'] . '/step'))['job']['status']);
        self::assertSame([], glob(self::storage() . '/jobs/*') ?: []);
    }

    public function testExportSelection(): void
    {
        $alice = $this->userClient('Alice');
        $mine = $this->uploadOk($alice, 'valid_png_opaque.png');
        $bob = $this->userClient('Bob', 'user', '203.0.113.11');
        $bobs = $this->uploadOk($bob, 'valid_gif_static.gif');
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        $general = $this->uploadOk($admin, 'valid_webp_lossy.webp', ['scope' => 'general']);

        self::assertSame(['asset_ids' => 'invalid'], $alice->post('/asset-packs/export', ['asset_ids' => [$bobs['id']]])->payload()['error']['fields']);
        self::assertSame(['asset_ids' => 'invalid'], $alice->post('/asset-packs/export', ['asset_ids' => 'x'])->payload()['error']['fields']);
        self::assertSame(['asset_ids' => 'empty'], $admin->post('/asset-packs/export', [])->payload()['error']['fields']);
        $job = $alice->post('/asset-packs/export', ['asset_ids' => [$mine['id'], $general['id']]]);
        self::assertSame(202, $job->status());
        $done = $this->runJob($alice, $job->payload()['data']['job']['id']);
        self::assertSame(2, $done['result']['count']);
    }

    /**
     * Drives a job like the browser does (POST /jobs/{id}/step until finished).
     *
     * @return array<string, mixed>
     */
    private function runJob(ApiClient $client, string $id): array
    {
        for ($i = 0; $i < 50; $i++) {
            $response = $client->post('/jobs/' . $id . '/step');
            self::assertSame(200, $response->status(), $response->body());
            $job = $response->payload()['data']['job'];
            if (in_array($job['status'], ['done', 'failed', 'cancelled'], true)) {
                self::assertEquals($job, self::data($client->get('/jobs/' . $id))['job']); // JSON column: key order may change

                return $job;
            }
        }
        self::fail('Job did not finish');
    }
}
