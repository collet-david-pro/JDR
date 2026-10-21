<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

/**
 * Rights on every asset route (projet.md 11.2): anonymous 401, another user's personal asset
 * 404 (admins included: no access to personal assets of others), general library read by all
 * and changed by admins only, CSRF on writes.
 */
final class RightsMatrixTest extends AssetsTestCase
{
    /**
     * @return list<array{0: string, 1: string}>
     */
    private static function routes(string $assetId, string $otherId = '1'): array
    {
        return [
            ['GET', '/assets/limits'], ['GET', '/assets'], ['POST', '/assets'], ['GET', '/assets/' . $assetId],
            ['PATCH', '/assets/' . $assetId], ['DELETE', '/assets/' . $assetId], ['GET', '/assets/' . $assetId . '/usages'],
            ['PUT', '/assets/' . $assetId . '/favorite'], ['DELETE', '/assets/' . $assetId . '/favorite'],
            ['GET', '/asset-categories'], ['POST', '/asset-categories'], ['PATCH', '/asset-categories/' . $otherId],
            ['DELETE', '/asset-categories/' . $otherId], ['GET', '/asset-tags'], ['POST', '/asset-tags'],
            ['DELETE', '/asset-tags/' . $otherId], ['POST', '/asset-packs/import'], ['POST', '/asset-packs/export'],
            ['GET', '/jobs/' . $otherId], ['POST', '/jobs/' . $otherId . '/step'], ['POST', '/jobs/' . $otherId . '/cancel'],
            ['GET', '/jobs/' . $otherId . '/download'],
        ];
    }

    public function testAnonymousGets401Everywhere(): void
    {
        $anonymous = $this->client();
        $anonymous->me();
        foreach (self::routes('1') as [$method, $path]) {
            $response = $anonymous->request($method, $path, $method === 'GET' ? null : []);
            self::assertSame(401, $response->status(), $method . ' ' . $path);
            self::assertSame('unauthenticated', self::errorCode($response));
        }
        // The file endpoint is public but needs a valid signature.
        self::assertSame(403, $anonymous->get('/files/' . str_repeat('a', 8) . '-aaaa-4aaa-8aaa-' . str_repeat('a', 12))->status());
    }

    public function testPersonalAssetsOfOthersAreInvisible(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $category = self::data($alice->post('/asset-categories', ['name' => 'Privée']));
        $tag = self::data($alice->post('/asset-tags', ['name' => 'privé']));
        $job = self::data($alice->post('/asset-packs/export', []))['job'];

        $bob = $this->userClient('Bob', 'user', '203.0.113.11');
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        foreach (['Bob' => $bob, 'Admin' => $admin] as $who => $other) {
            $checks = [
                ['GET', '/assets/' . $asset['id']], ['PATCH', '/assets/' . $asset['id']], ['DELETE', '/assets/' . $asset['id']],
                ['GET', '/assets/' . $asset['id'] . '/usages'], ['PUT', '/assets/' . $asset['id'] . '/favorite'],
                ['DELETE', '/assets/' . $asset['id'] . '/favorite'],
                ['PATCH', '/asset-categories/' . $category['id']], ['DELETE', '/asset-categories/' . $category['id']],
                ['DELETE', '/asset-tags/' . $tag['id']],
                ['GET', '/jobs/' . $job['id']], ['POST', '/jobs/' . $job['id'] . '/step'],
            ];
            foreach ($checks as [$method, $path]) {
                $response = $other->request($method, $path, $method === 'GET' ? null : ['name' => 'x']);
                self::assertSame(404, $response->status(), $who . ' ' . $method . ' ' . $path . ' ' . $response->body());
            }
            self::assertSame([], self::data($other->get('/assets')));
            self::assertNotContains('Privée', array_column(self::data($other->get('/asset-categories')), 'name'));
            self::assertNotContains('privé', array_column(self::data($other->get('/asset-tags')), 'name'));
            $export = $other->post('/asset-packs/export', ['asset_ids' => [$asset['id']]]);
            self::assertSame(422, $export->status());
        }
        // Alice's asset is untouched.
        self::assertSame(200, $alice->get('/assets/' . $asset['id'])->status());
        self::assertSame('valid png opaque', self::data($alice->get('/assets/' . $asset['id']))['name']);
    }

    public function testGeneralLibraryIsReadByAllAndManagedByAdmins(): void
    {
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        $asset = $this->uploadOk($admin, 'valid_png_opaque.png', ['scope' => 'general']);
        $alice = $this->userClient('Alice');

        self::assertSame(200, $alice->get('/assets/' . $asset['id'])->status());
        self::assertSame([$asset['id']], array_column(self::data($alice->get('/assets?scope=general')), 'id'));
        self::assertSame(200, $this->client()->get(self::apiPath(self::data($alice->get('/assets/' . $asset['id']))['urls']['thumb']))->status());
        self::assertSame(204, $alice->put('/assets/' . $asset['id'] . '/favorite', null)->status());
        self::assertTrue(self::data($alice->get('/assets/' . $asset['id']))['favorite']);
        self::assertFalse(self::data($admin->get('/assets/' . $asset['id']))['favorite']);
        self::assertSame(403, $alice->patch('/assets/' . $asset['id'], ['name' => 'x'])->status());
        self::assertSame(403, $alice->delete('/assets/' . $asset['id'])->status());
        self::assertSame(403, $alice->get('/assets/' . $asset['id'] . '/usages')->status());

        self::assertSame(200, $admin->patch('/assets/' . $asset['id'], ['name' => 'Sol', 'tags' => ['commun']])->status());
        self::assertSame('general', self::data($alice->get('/asset-tags'))[0]['scope']);
        self::assertSame(200, $admin->get('/assets/' . $asset['id'] . '/usages')->status());
        self::assertSame(204, $admin->delete('/assets/' . $asset['id'])->status());
        self::assertSame([], self::data($alice->get('/assets?scope=general')));
    }

    public function testWritesNeedTheCsrfToken(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $noCsrf = $alice->request('PATCH', '/assets/' . $asset['id'], ['name' => 'x'], [], false);
        self::assertSame(403, $noCsrf->status());
        self::assertSame('csrf_invalid', self::errorCode($noCsrf));
        $token = $alice->csrf;
        $alice->csrf = null;
        $upload = $alice->upload('/assets', self::fixture('valid_gif_static.gif'), ['kind' => 'object']);
        self::assertSame('csrf_invalid', self::errorCode($upload));
        $alice->csrf = $token;
    }

    public function testJobsSurviveSlicesOfZeroBudget(): void
    {
        $alice = $this->userClient('Alice');
        foreach (['valid_png_opaque.png', 'valid_gif_static.gif', 'valid_webp_lossy.webp'] as $fixture) {
            $this->uploadOk($alice, $fixture);
        }
        $jobId = (int) self::data($alice->post('/asset-packs/export', []))['job']['id'];
        $runner = $this->app->container()->get(\JDR\Domain\Jobs\JobRunner::class);
        $jobs = $this->app->container()->get(\JDR\Domain\Jobs\JobRepository::class);
        $seen = [];
        do {
            $job = $runner->step($jobs->find($jobId) ?? self::fail('job lost'), 0.0);
            $seen[] = $job->done;
        } while (!$job->isFinished());
        self::assertSame([1, 2, 3], $seen);
        self::assertSame('done', $job->status);
        $download = $alice->get('/jobs/' . $jobId . '/download');
        $zip = self::storage() . '/slices.zip';
        file_put_contents($zip, $download->contents());
        self::assertCount(4, (new \JDR\Zip\ZipReader($zip))->entries());
    }
}
