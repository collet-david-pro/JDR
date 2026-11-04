<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Request;
use JDR\Domain\Support\AppPaths;
use JDR\Domain\Update\ReleaseDownloader;
use JDR\Domain\Update\ReleaseHttpClient;
use JDR\Domain\Update\ReleaseSignature;
use JDR\Domain\Update\UpdateChecker;
use JDR\Domain\Update\UpdatePackage;
use JDR\Domain\Update\UpdateStorage;
use JDR\Install\HttpResult;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Api\ApiTestCase;

/**
 * POST /admin/update/install-latest ("Install now"): fake GitHub, fake downloader, temporary installation.
 */
final class InstallLatestTest extends ApiTestCase
{
    private const VERSION = '9.0.0';
    private const BASE = 'https://github.com/' . UpdateChecker::REPOSITORY . '/releases/download/v9.0.0/';

    private string $install;
    private string $zip = '';
    private string $secretKey = '';
    private FakeReleaseDownloader $downloader;

    protected function setUp(): void
    {
        parent::setUp();
        Fixture::markRealMigrationsApplied($this->db);
        $this->install = Fixture::install(Fixture::oldFiles() + Fixture::realMigrations(), \APP_VERSION);
        $this->app->container()->instance(AppPaths::class, new AppPaths($this->install, $this->install . '/storage', $this->install));
        $pair = sodium_crypto_sign_keypair();
        $this->secretKey = sodium_crypto_sign_secretkey($pair);
        $this->bindSignature(true);
        $this->createUser('Root', 'admin');
        $this->createUser('Player');
    }

    protected function tearDown(): void
    {
        Fixture::remove($this->install);
    }

    private function bindSignature(bool $available): void
    {
        $public = base64_encode(sodium_crypto_sign_publickey_from_secretkey($this->secretKey));
        $this->app->container()->instance(ReleaseSignature::class, new ReleaseSignature($public, $available));
    }

    /**
     * @param string $sign 'valid' | 'none' | 'bad'
     */
    private function publish(string $version = self::VERSION, string $sign = 'valid', bool $download = true): void
    {
        $files = Fixture::newFiles() + Fixture::realMigrations();
        $this->zip = Fixture::zip($this->install . '/storage', $files, $version);
        $name = 'jdr-update-v' . $version . '.zip';
        $base = str_replace(self::VERSION, $version, self::BASE);
        $assets = [['name' => $name, 'browser_download_url' => $base . $name, 'size' => (int) filesize($this->zip)]];
        $responses = [];
        $assets[] = ['name' => 'SHA256SUMS', 'browser_download_url' => $base . 'SHA256SUMS'];
        $listing = hash_file('sha256', $this->zip) . '  ' . $name . "\n";
        $responses[$base . 'SHA256SUMS'] = new HttpResult(200, $listing);
        if ($sign !== 'none') {
            $assets[] = ['name' => 'SHA256SUMS.sig', 'browser_download_url' => $base . 'SHA256SUMS.sig'];
            $signed = $sign === 'bad' ? $listing . 'x' : $listing;
            $responses[$base . 'SHA256SUMS.sig'] = new HttpResult(200, base64_encode(sodium_crypto_sign_detached($signed, $this->secretKey)) . "\n");
        }
        $responses[UpdateChecker::apiUrl()] = FakeReleaseHttp::releases([[
            'tag_name' => 'v' . $version, 'name' => 'v' . $version, 'draft' => false, 'prerelease' => false,
            'published_at' => '2026-11-03T10:00:00Z', 'body' => '', 'html_url' => 'https://github.com/x', 'assets' => $assets,
        ]]);
        $this->app->container()->instance(ReleaseHttpClient::class, new FakeReleaseHttp($responses));
        $this->downloader = new FakeReleaseDownloader($download ? $this->zip : null);
        $this->app->container()->instance(ReleaseDownloader::class, $this->downloader);
    }

    private function admin(): ApiClient
    {
        $client = $this->client();
        $client->login('Root', self::PASSWORD);

        return $client;
    }

    private function assertRefused(string $code): void
    {
        $response = $this->admin()->post('/admin/update/install-latest');
        self::assertSame(409, $response->status(), $response->body());
        self::assertSame($code, $response->payload()['error']['code']);
        self::assertNull(UpdateStorage::for($this->install, $this->install . '/storage')->latestRun());
        self::assertNull($this->app->container()->get(UpdatePackage::class)->pending() , 'nothing pending after a refusal');
    }

    public function testRights(): void
    {
        $this->publish();
        self::assertSame(401, $this->client()->post('/admin/update/install-latest')->status());
        $player = $this->client('203.0.113.20');
        $player->login('Player', self::PASSWORD);
        self::assertSame(403, $player->post('/admin/update/install-latest')->status());
        $admin = $this->admin();
        $request = Request::create('POST', '/api/v1/admin/update/install-latest', ['User-Agent' => $admin->userAgent], '', '', ['REMOTE_ADDR' => $admin->ip], $admin->cookies);
        self::assertSame(403, $this->app->handle($request)->status(), 'CSRF token required');
        self::assertSame([], $this->downloader->urls);
    }

    public function testInstallsTheSignedReleaseAsThePendingPackage(): void
    {
        $this->publish();
        $admin = $this->admin();
        $response = $admin->post('/admin/update/install-latest');
        self::assertSame(201, $response->status(), $response->body());
        $pending = $response->payload()['data']['pending'];
        self::assertSame(self::VERSION, $pending['version']);
        self::assertSame(hash_file('sha256', $this->zip), $pending['sha256']);
        self::assertSame('verified', $pending['authenticity']);
        self::assertSame([self::BASE . 'jdr-update-v9.0.0.zip'], $this->downloader->urls);
        self::assertSame(self::VERSION, $admin->get('/admin/update')->payload()['data']['pending']['version']);
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('audit_log') . " WHERE `action` = 'update.install_latest'"));
        self::assertSame(429, $admin->post('/admin/update/install-latest')->status(), '1 per 30 s');
    }

    public function testWorksWhenTheAutomaticUpdateIsOffAndDuringARecentSession(): void
    {
        $this->publish();
        $admin = $this->admin();
        self::assertSame(200, $admin->patch('/admin/update', ['auto' => false])->status());
        $this->db->pdo()->exec('SET FOREIGN_KEY_CHECKS = 0');
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('play_sessions') . " (`game_id`, `code`, `state`, `created_at`, `started_at`) VALUES (1, 'ABCD2345', 'running', UTC_TIMESTAMP(), UTC_TIMESTAMP())",
        );
        $this->db->pdo()->exec('SET FOREIGN_KEY_CHECKS = 1');
        $auto = $admin->get('/admin/update')->payload()['data']['auto'];
        self::assertTrue($auto['session_guard']);
        self::assertSame(21600, $auto['check_ttl']);
        self::assertSame(201, $admin->post('/admin/update/install-latest')->status());
    }

    public function testRefusesABadSignature(): void
    {
        $this->publish(self::VERSION, 'bad');
        $this->assertRefused('update.bad_signature');
        self::assertSame([], $this->downloader->urls, 'nothing downloaded');
    }

    public function testRefusesAnUnsignedRelease(): void
    {
        $this->publish(self::VERSION, 'none');
        $this->assertRefused('update.unsigned');
        self::assertSame([], $this->downloader->urls);
    }

    public function testRefusesWhenSodiumIsMissing(): void
    {
        $this->publish();
        $this->bindSignature(false);
        $this->assertRefused('update.sodium_missing');
    }

    public function testRefusesWhenNothingIsNewer(): void
    {
        $this->publish('0.0.1');
        $this->assertRefused('update.no_newer');
    }

    public function testRefusesWhenGitHubIsUnreachable(): void
    {
        $this->publish();
        $this->app->container()->instance(ReleaseHttpClient::class, new FakeReleaseHttp());
        $this->assertRefused('update.check_failed');
    }

    public function testRefusesAFailedDownload(): void
    {
        $this->publish(self::VERSION, 'valid', false);
        $this->assertRefused('update.download_failed');
    }

    public function testRefusesOnADevelopmentCopy(): void
    {
        $this->publish();
        mkdir($this->install . '/.git');
        $this->assertRefused('update.install_unsupported');
    }

    public function testRefusesWhileARunIsInProgress(): void
    {
        $this->publish();
        $storage = UpdateStorage::for($this->install, $this->install . '/storage');
        $storage->writeJson($storage->dir() . '/auto-run.json', ['id' => 'x', 'to' => '9.0.0', 'started_at' => time()]);
        $this->assertRefused('update.run_in_progress');
    }

    public function testRefusesWhileAPackageIsPending(): void
    {
        $this->publish();
        $copy = $this->install . '/storage/copy.zip';
        copy($this->zip, $copy);
        $this->app->container()->get(UpdatePackage::class)->accept($copy, 1);
        $response = $this->admin()->post('/admin/update/install-latest');
        self::assertSame(409, $response->status());
        self::assertSame('update.package_pending', $response->payload()['error']['code']);
    }
}
