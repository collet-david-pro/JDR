<?php

declare(strict_types=1);

namespace JDR\Tests\Procgen;

use JDR\Domain\Procgen\BasePackInstaller;
use JDR\Domain\Procgen\BasePackManifest;
use JDR\Domain\Settings\Settings;
use JDR\Tests\Assets\AssetsTestCase;

/**
 * Base pack: installation by slices, new version, retry of failures, admin repair route.
 */
final class BasePackRepairTest extends AssetsTestCase
{
    private const FILES = [
        'floor.stone' => 'valid_png_opaque.png',
        'floor.wood' => 'valid_png_transparent.png',
        'decor.tree' => 'valid_webp_lossless.webp',
    ];

    private string $dir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = self::$root . '/base-pack-repair';
        self::emptyDir($this->dir);
        @mkdir($this->dir, 0775, true);
    }

    /**
     * @param list<string> $keys
     */
    private function manifest(int $version, array $keys): void
    {
        $entries = [];
        foreach ($keys as $key) {
            copy(self::fixture(self::FILES[$key]), $this->dir . '/' . $key . '.png');
            $entries[] = ['key' => $key, 'file' => $key . '.png', 'name' => $key, 'category' => 'Sols', 'kind' => 'tile', 'tags' => ['Pack'], 'rgba_sha256' => str_repeat('a', 64)];
        }
        file_put_contents($this->dir . '/pack.json', json_encode(['version' => $version, 'entries' => $entries]));
        $this->app = $this->makeApp();
        $this->app->container()->instance(BasePackManifest::class, new BasePackManifest(null, $this->dir . '/pack.json'));
    }

    private function installer(): BasePackInstaller
    {
        return $this->app->container()->get(BasePackInstaller::class);
    }

    public function testInstallsBySlicesAndResumes(): void
    {
        $this->manifest(1, array_keys(self::FILES));
        $first = $this->installer()->installSlice(2);
        self::assertSame(2, $first['installed']);
        self::assertSame(1, $first['remaining']);
        self::assertFalse($first['complete']);
        self::assertTrue($this->installer()->pending());

        // A new request resumes where the previous one stopped.
        $this->manifest(1, array_keys(self::FILES));
        $second = $this->installer()->installSlice(2);
        self::assertSame(1, $second['installed']);
        self::assertSame(2, $second['present']);
        self::assertTrue($second['complete']);
        self::assertFalse($this->installer()->pending());
        self::assertSame(3, $this->rows('assets'));

        $third = $this->installer()->installSlice(2);
        self::assertSame(0, $third['installed']);
        self::assertSame(3, $third['present']);
        self::assertSame(3, $this->rows('assets'));
    }

    public function testNewVersionIsInstalledOnTickWithoutDuplicates(): void
    {
        $this->manifest(1, ['floor.stone', 'floor.wood']);
        self::assertTrue($this->installer()->installSlice(10)['complete']);
        self::assertNull($this->installer()->tick(5.0));

        $this->manifest(2, ['floor.stone', 'floor.wood', 'decor.tree']);
        self::assertTrue($this->installer()->outdated());
        $report = $this->installer()->tick(5.0);
        self::assertNotNull($report);
        self::assertTrue($report['complete']);
        self::assertSame(1, $report['installed']);
        self::assertSame(3, $this->rows('assets'));
        self::assertFalse($this->installer()->pending());
    }

    public function testFailuresAreRetried(): void
    {
        $this->manifest(1, ['floor.stone', 'floor.wood']);
        $good = (string) file_get_contents($this->dir . '/floor.stone.png');
        file_put_contents($this->dir . '/floor.stone.png', 'not an image');
        $report = $this->installer()->installSlice(10);
        self::assertTrue($report['complete']);
        self::assertSame(['floor.stone'], array_column($report['failed'], 'key'));
        self::assertNotSame('', $report['failed'][0]['reason']);
        self::assertSame(1, $this->rows('assets'));
        // Retry not due yet: the cron leaves it alone.
        self::assertFalse($this->installer()->pending());

        file_put_contents($this->dir . '/floor.stone.png', $good);
        $this->manifest(1, ['floor.stone', 'floor.wood']);
        file_put_contents($this->dir . '/floor.stone.png', $good);
        $again = $this->installer()->installSlice(10, 8.0, true);
        self::assertSame([], $again['failed']);
        self::assertSame(1, $again['installed']);
        self::assertSame(2, $this->rows('assets'));

        // Retry becomes due after the delay.
        $settings = $this->app->container()->get(Settings::class);
        $state = $settings->get('base_pack');
        $state['failed'] = ['floor.stone' => 'x'];
        $state['retry_at'] = time() + 3600;
        $settings->set('base_pack', $state);
        self::assertFalse($this->installer()->pending());
        $state['retry_at'] = time() - 1;
        $settings->set('base_pack', $state);
        self::assertTrue($this->installer()->pending());
    }

    public function testAdminRouteRightsCsrfAndReport(): void
    {
        $this->manifest(1, array_keys(self::FILES));
        self::assertSame(401, $this->client()->post('/admin/base-pack/install', [])->status());
        $user = $this->userClient('Bob', 'user', '203.0.113.21');
        self::assertSame(403, $user->post('/admin/base-pack/install', [])->status());

        $admin = $this->userClient('Root', 'admin', '203.0.113.22');
        self::assertSame(403, $admin->request('POST', '/admin/base-pack/install', [], [], false)->status());
        $response = $admin->post('/admin/base-pack/install', []);
        self::assertSame(200, $response->status(), $response->body());
        $data = self::data($response);
        self::assertSame(3, $data['installed']);
        self::assertSame(3, $data['total']);
        self::assertTrue($data['complete']);
        self::assertSame([], $data['failed']);
        self::assertSame(1, $this->rows('audit_log', "`action` = 'base_pack.install'"));

        $again = self::data($admin->post('/admin/base-pack/install', ['resume' => true]));
        self::assertSame(0, $again['installed']);
        self::assertSame(3, $again['present']);
        self::assertSame(2, $this->rows('audit_log', "`action` = 'base_pack.install'"));
    }
}
