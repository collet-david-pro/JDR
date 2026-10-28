<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Support\AppPaths;
use JDR\Domain\Update\ReleaseHttpClient;
use JDR\Domain\Update\UpdateChecker;
use JDR\Install\HttpResult;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Api\ApiTestCase;

final class AdminUpdateApiTest extends ApiTestCase
{
    private string $install;
    private FakeReleaseHttp $http;

    protected function setUp(): void
    {
        parent::setUp();
        Fixture::markRealMigrationsApplied($this->db);
        $this->install = Fixture::install(Fixture::oldFiles() + Fixture::realMigrations(), \APP_VERSION);
        $this->http = new FakeReleaseHttp();
        // Never the repository: the update module works on a temporary installation, and never online.
        $this->app->container()->instance(AppPaths::class, new AppPaths($this->install, $this->install . '/storage', $this->install));
        $this->app->container()->instance(ReleaseHttpClient::class, $this->http);
        $this->createUser('Root', 'admin');
        $this->createUser('Player');
    }

    protected function tearDown(): void
    {
        Fixture::remove($this->install);
    }

    private function admin(): ApiClient
    {
        $client = $this->client();
        $client->login('Root', self::PASSWORD);

        return $client;
    }

    private function put(ApiClient $client, string $uploadId, string $offset, string $data): Response
    {
        $request = Request::create('PUT', '/api/v1/admin/update/uploads/' . $uploadId . '?offset=' . $offset, [
            'User-Agent' => $client->userAgent, 'X-CSRF-Token' => (string) $client->csrf, 'Content-Type' => 'application/octet-stream',
        ], $data, '', ['REMOTE_ADDR' => $client->ip], $client->cookies);

        return $this->app->handle($request);
    }

    /**
     * @return array{0:string,1:string} upload id, archive bytes
     */
    private function upload(ApiClient $client, string $data, ?string $sha = null): array
    {
        $created = $client->post('/admin/update/uploads', ['size' => strlen($data), 'sha256' => $sha ?? hash('sha256', $data)]);
        self::assertSame(201, $created->status(), $created->body());
        $id = (string) $created->payload()['data']['upload_id'];
        self::assertGreaterThanOrEqual(65536, $created->payload()['data']['chunk_bytes']);

        return [$id, $data];
    }

    private function zipBytes(string $version = '0.2.0'): string
    {
        $files = Fixture::newFiles() + Fixture::realMigrations();

        return (string) file_get_contents(Fixture::zip($this->install . '/storage', $files, $version));
    }

    public function testRights(): void
    {
        self::assertSame(401, $this->client()->get('/admin/update')->status());
        $player = $this->client('203.0.113.20');
        $player->login('Player', self::PASSWORD);
        self::assertSame(403, $player->get('/admin/update')->status());
        self::assertSame(403, $player->post('/admin/update/uploads', ['size' => 10, 'sha256' => str_repeat('a', 64)])->status());
        self::assertSame(403, $player->post('/admin/update/start')->status());

        $show = $this->admin()->get('/admin/update');
        self::assertSame(200, $show->status());
        $data = $show->payload()['data'];
        self::assertSame(\APP_VERSION, $data['current']);
        self::assertSame(\REQUIRED_DB_VERSION, $data['required_db_version']);
        // Default channel: pre-releases while the installed version is itself a pre-release.
        self::assertSame(str_contains(\APP_VERSION, '-') ? 'prerelease' : 'stable', $data['channel']);
        self::assertNull($data['check']);
        self::assertNull($data['pending']);
        self::assertNull($data['run']);
        self::assertSame(104857600, $data['upload_max_bytes']);
        self::assertArrayHasKey('upload_max_filesize', $data['php']);
        self::assertSame('/update.php', $data['update_url']);
    }

    public function testChunkedUploadThenStart(): void
    {
        $admin = $this->admin();
        [$id, $bytes] = $this->upload($admin, $this->zipBytes());
        $half = intdiv(strlen($bytes), 2);
        $first = substr($bytes, 0, $half);
        self::assertSame($half, $this->put($admin, $id, '0', $first)->payload()['data']['received']);
        $gap = $this->put($admin, $id, (string) ($half + 10), 'x');
        self::assertSame(409, $gap->status());
        self::assertSame('update.bad_offset', self::errorCode($gap));
        self::assertSame($half, $gap->payload()['error']['fields']['received']);
        self::assertSame(422, $this->put($admin, $id, 'abc', 'x')->status());
        // Replayed chunk (answer lost): accepted again.
        self::assertSame($half, $this->put($admin, $id, '0', $first)->payload()['data']['received']);
        $early = $admin->post('/admin/update/uploads/' . $id . '/complete');
        self::assertSame(409, $early->status());
        self::assertSame('update.upload_incomplete', self::errorCode($early));
        self::assertSame(strlen($bytes), $this->put($admin, $id, (string) $half, substr($bytes, $half))->payload()['data']['received']);
        self::assertSame(422, $this->put($admin, $id, (string) strlen($bytes), 'extra')->status(), 'beyond the declared size');
        self::assertSame(401, $this->put($this->client('203.0.113.99'), $id, '0', 'x')->status(), 'anonymous');

        $done = $admin->post('/admin/update/uploads/' . $id . '/complete');
        self::assertSame(201, $done->status(), $done->body());
        $pending = $done->payload()['data']['pending'];
        self::assertSame('0.2.0', $pending['version']);
        self::assertSame('unverified', $pending['authenticity']);
        self::assertSame($pending['id'], $admin->get('/admin/update')->payload()['data']['pending']['id']);
        self::assertSame(1, $this->rows('audit_log', "`action` = 'update.uploaded'"));

        $refused = $admin->post('/admin/update/start', []);
        self::assertSame(422, $refused->status());
        self::assertSame('update.unverified', self::errorCode($refused));
        $start = $admin->post('/admin/update/start', ['confirm_unverified' => true]);
        self::assertSame(200, $start->status(), $start->body());
        self::assertSame('/update.php?id=' . $pending['id'], $start->payload()['data']['redirect']);
        self::assertSame('ready', $admin->get('/admin/update')->payload()['data']['run']['state']);
        self::assertSame(1, $this->rows('audit_log', "`action` = 'update.started'"));

        self::assertSame(204, $admin->delete('/admin/update/pending')->status());
        self::assertNull($admin->get('/admin/update')->payload()['data']['pending']);
    }

    public function testRefusedArchives(): void
    {
        $admin = $this->admin();
        [$id, $bytes] = $this->upload($admin, str_repeat('not a zip ', 50));
        $this->put($admin, $id, '0', $bytes);
        $bad = $admin->post('/admin/update/uploads/' . $id . '/complete');
        self::assertSame(422, $bad->status());
        self::assertSame('update.invalid_zip', self::errorCode($bad));
        self::assertSame(404, $admin->post('/admin/update/uploads/' . $id . '/complete')->status(), 'refused upload discarded');

        [$id, $bytes] = $this->upload($admin, $this->zipBytes(), str_repeat('0', 64));
        $this->put($admin, $id, '0', $bytes);
        self::assertSame('update.upload_hash', self::errorCode($admin->post('/admin/update/uploads/' . $id . '/complete')));

        [$id, $bytes] = $this->upload($admin, $this->zipBytes(\APP_VERSION));
        $this->put($admin, $id, '0', $bytes);
        self::assertSame('update.not_newer', self::errorCode($admin->post('/admin/update/uploads/' . $id . '/complete')));

        $tooLarge = $admin->post('/admin/update/uploads', ['size' => 104857601, 'sha256' => str_repeat('a', 64)]);
        self::assertSame('update.too_large', self::errorCode($tooLarge));
        self::assertSame(422, $admin->post('/admin/update/uploads', ['size' => 10, 'sha256' => 'nope'])->status());
        self::assertSame('update.no_package', self::errorCode($admin->post('/admin/update/start', ['confirm_unverified' => true])));
    }

    public function testCheckAndChannel(): void
    {
        $this->http->responses = [
            UpdateChecker::apiUrl() => FakeReleaseHttp::releases([FakeReleaseHttp::release('v9.0.0'), FakeReleaseHttp::release('v9.1.0-beta.1', true)]),
            FakeReleaseHttp::sumsUrl('v9.0.0') => new HttpResult(200, str_repeat('d', 64) . "  jdr-update-v9.0.0.zip\n"),
        ];
        $admin = $this->admin();
        // Explicit channel: the default depends on the installed version (pre-release or not).
        self::assertSame(200, $admin->patch('/admin/update', ['channel' => 'stable'])->status());
        $check = $admin->post('/admin/update/check', ['force' => true]);
        self::assertSame(200, $check->status(), $check->body());
        self::assertSame('9.0.0', $check->payload()['data']['latest']['version']);
        self::assertSame(str_repeat('d', 64), $check->payload()['data']['latest']['update_asset']['sha256']);
        self::assertSame(429, $admin->post('/admin/update/check', ['force' => true])->status(), '1 forced check / 30 s');
        self::assertSame(200, $admin->post('/admin/update/check', [])->status(), 'cached check still allowed');
        self::assertSame('9.0.0', $admin->get('/admin/update')->payload()['data']['check']['latest']['version']);

        self::assertSame(422, $admin->patch('/admin/update', ['channel' => 'beta'])->status());
        self::assertSame(200, $admin->patch('/admin/update', ['channel' => 'prerelease'])->status());
        self::assertSame('prerelease', $admin->get('/admin/update')->payload()['data']['channel']);
        self::assertSame('9.1.0-beta.1', $admin->post('/admin/update/check', [])->payload()['data']['latest']['version']);
    }
}
