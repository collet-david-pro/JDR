<?php

declare(strict_types=1);

namespace JDR\Tests\Backup;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Backup\BackupStorage;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Api\ApiTestCase;

final class BackupApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->createUser('Root', 'admin');
        $this->createUser('Player');
        self::wipe(self::$root . '/storage/backup-tmp');
        self::wipe(self::$root . '/storage/assets');
    }

    private function admin(): ApiClient
    {
        $client = $this->client();
        $client->login('Root', self::PASSWORD);

        return $client;
    }

    /**
     * @return array<string, mixed> the finished job
     */
    private function runJob(ApiClient $client, array $job): array
    {
        for ($i = 0; $i < 10000 && !in_array($job['status'], ['done', 'failed', 'cancelled'], true); $i++) {
            $step = $client->post('/jobs/' . $job['id'] . '/step');
            self::assertSame(200, $step->status(), $step->body());
            $job = $step->payload()['data']['job'];
        }

        return $job;
    }

    private function backup(ApiClient $client, string $kind): array
    {
        $created = $client->post('/admin/backup/jobs', ['kind' => $kind]);
        self::assertSame(201, $created->status(), $created->body());

        return $this->runJob($client, $created->payload()['data']['job']);
    }

    /**
     * Sends $bytes in chunks of 100 kB; returns the upload id.
     */
    private function upload(ApiClient $client, string $kind, string $bytes): string
    {
        $created = $client->post('/admin/backup/uploads', ['kind' => $kind, 'size' => strlen($bytes)]);
        self::assertSame(201, $created->status(), $created->body());
        $id = (string) $created->payload()['data']['upload_id'];
        for ($offset = 0; $offset < strlen($bytes); $offset += 100000) {
            $put = $this->put($client, $id, $offset, substr($bytes, $offset, 100000));
            self::assertSame(200, $put->status(), $put->body());
        }

        return $id;
    }

    private function put(ApiClient $client, string $id, int $offset, string $data): Response
    {
        $request = Request::create('PUT', '/api/v1/admin/backup/uploads/' . $id . '?offset=' . $offset, [
            'User-Agent' => $client->userAgent, 'X-CSRF-Token' => (string) $client->csrf, 'Content-Type' => 'application/octet-stream',
        ], $data, '', ['REMOTE_ADDR' => $client->ip], $client->cookies);

        return $this->app->handle($request);
    }

    private static function sent(Response $response): void
    {
        ob_start();
        try {
            $response->send();
        } finally {
            ob_end_clean();
        }
    }

    private function dump(string $version, string ...$lines): string
    {
        $header = '-- JDR database backup, version ' . $version . ', 2026-01-01 00:00:00 UTC, prefix ' . $this->db->prefix();

        return (string) gzencode(implode("\n", [$header, 'SET NAMES utf8mb4;', ...$lines, '-- end']) . "\n");
    }

    private static function wipe(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($items as $item) {
            $item->isDir() && !$item->isLink() ? rmdir($item->getPathname()) : unlink($item->getPathname());
        }
        rmdir($dir);
    }

    public function testRights(): void
    {
        $anonymous = $this->client();
        self::assertSame(401, $anonymous->get('/admin/backup')->status());
        self::assertSame(401, $anonymous->post('/admin/backup/jobs', ['kind' => 'db'])->status());
        $player = $this->client('203.0.113.20');
        $player->login('Player', self::PASSWORD);
        self::assertSame(403, $player->get('/admin/backup')->status());
        self::assertSame(403, $player->post('/admin/backup/jobs', ['kind' => 'db'])->status());
        self::assertSame(403, $player->post('/admin/backup/uploads', ['kind' => 'db', 'size' => 10])->status());
        self::assertSame(403, $player->post('/admin/backup/restore/db', ['upload_id' => str_repeat('a', 32)])->status());
        // A step without the right token is unknown.
        self::assertSame(404, $player->post('/admin/backup/restore/db/' . str_repeat('a', 32) . '/step', ['token' => str_repeat('b', 32)])->status());

        $show = $this->admin()->get('/admin/backup');
        self::assertSame(200, $show->status(), $show->body());
        $data = $show->payload()['data'];
        self::assertSame(\APP_VERSION, $data['current_version']);
        self::assertSame(536870912, $data['limits']['db_max_bytes']);
        self::assertSame(1073741824, $data['limits']['assets_max_bytes']);
        self::assertNull($data['restore']);
    }

    public function testDbBackupIsDeletedAfterDownload(): void
    {
        $admin = $this->admin();
        $job = $this->backup($admin, 'db');
        self::assertSame('done', $job['status']);
        self::assertMatchesRegularExpression('/^jdr-db-\d{8}-\d{6}-v[0-9A-Za-z._-]+\.sql\.gz$/', $job['result']['file_name']);
        $download = $admin->get('/jobs/' . $job['id'] . '/download');
        self::assertSame(200, $download->status(), $download->body());
        self::assertStringContainsString($job['result']['file_name'], (string) $download->header('Content-Disposition'));
        $path = $download->file()['path'] ?? '';
        self::assertFileExists($path);
        self::assertStringStartsWith('-- JDR database backup, version ' . \APP_VERSION, (string) gzdecode($download->contents()));
        self::sent($download);
        self::assertFileDoesNotExist($path);
        self::assertSame(410, $admin->get('/jobs/' . $job['id'] . '/download')->status());
        // Another admin's (or a player's) job is not visible.
        $player = $this->client('203.0.113.20');
        $player->login('Player', self::PASSWORD);
        self::assertSame(404, $player->get('/jobs/' . $job['id'] . '/download')->status());
    }

    public function testBackupPurgedAfterOneHour(): void
    {
        $admin = $this->admin();
        $job = $this->backup($admin, 'db');
        $storage = $this->app->container()->get(BackupStorage::class);
        $storage->purge(time() + 60);
        self::assertSame(200, $admin->get('/jobs/' . $job['id'] . '/download')->status());
        self::assertGreaterThan(0, $storage->purge(time() + BackupStorage::TTL_SECONDS + 5));
        self::assertSame(410, $admin->get('/jobs/' . $job['id'] . '/download')->status());
    }

    public function testDatabaseRestoreRoundTrip(): void
    {
        $admin = $this->admin();
        $job = $this->backup($admin, 'db');
        $download = $admin->get('/jobs/' . $job['id'] . '/download');
        $bytes = $download->contents();
        self::sent($download);
        $this->createUser('Extra');
        self::assertSame(1, $this->rows('users', '`username` = ?', ['Extra']));

        $this->db->execute('INSERT INTO ' . $this->db->t('php_sessions') . ' (`id`, `data`, `last_activity`) VALUES (?, ?, ?)', [str_repeat('c', 64), '', time()]);
        $id = $this->upload($admin, 'db', $bytes);
        $start = $admin->post('/admin/backup/restore/db', ['upload_id' => $id]);
        self::assertSame(201, $start->status(), $start->body());
        $restore = $start->payload()['data']['restore'];
        self::assertSame('running', $restore['status']);
        self::assertSame(32, strlen($restore['token']));
        self::assertTrue($this->setting('maintenance'));
        for ($i = 0; $i < 100 && $restore['status'] === 'running'; $i++) {
            $step = $admin->post('/admin/backup/restore/db/' . $restore['id'] . '/step', ['token' => $start->payload()['data']['restore']['token']]);
            self::assertSame(200, $step->status(), $step->body());
            $restore = $step->payload()['data']['restore'];
        }
        self::assertSame('done', $restore['status'], json_encode($restore));
        self::assertSame(100, $restore['progress']['percent']);
        self::assertFalse($restore['schema_behind']);
        self::assertSame(0, $this->rows('users', '`username` = ?', ['Extra']));
        self::assertSame(1, $this->rows('users', '`username` = ?', ['Root']));
        self::assertFalse($this->setting('maintenance'));
        self::assertSame(1, $this->rows('audit_log', '`action` = ?', ['backup.db_restored']));
        // Every session stored in the database is closed (the tests keep theirs in memory).
        self::assertSame(0, $this->rows('php_sessions'));
    }

    public function testDumpChecksBeforeAnyChange(): void
    {
        $admin = $this->admin();
        $tooRecent = $admin->post('/admin/backup/restore/db', ['upload_id' => $this->upload($admin, 'db', $this->dump('99.0.0'))]);
        self::assertSame(422, $tooRecent->status());
        self::assertSame('backup.too_recent', self::errorCode($tooRecent));
        $plain = $admin->post('/admin/backup/restore/db', ['upload_id' => $this->upload($admin, 'db', "-- not gzip\n")]);
        self::assertSame(422, $plain->status());
        self::assertSame('backup.invalid_file', self::errorCode($plain));
        $noHeader = $admin->post('/admin/backup/restore/db', ['upload_id' => $this->upload($admin, 'db', (string) gzencode("SELECT 1;\n"))]);
        self::assertSame('backup.invalid_file', self::errorCode($noHeader));
        $wrongKind = $admin->post('/admin/backup/restore/assets', ['upload_id' => $this->upload($admin, 'db', $this->dump(\APP_VERSION))]);
        self::assertSame('backup.wrong_kind', self::errorCode($wrongKind));
        self::assertNotTrue($this->setting('maintenance'));
    }

    public function testForbiddenStatementStopsBeforeAnyChange(): void
    {
        $admin = $this->admin();
        $p = $this->db->prefix();
        $bytes = $this->dump(\APP_VERSION, 'DROP TABLE IF EXISTS `' . $p . 'settings`;', 'DELETE FROM `' . $p . 'users`;');
        $start = $admin->post('/admin/backup/restore/db', ['upload_id' => $this->upload($admin, 'db', $bytes)]);
        self::assertSame(201, $start->status(), $start->body());
        $restore = $start->payload()['data']['restore'];
        $step = $admin->post('/admin/backup/restore/db/' . $restore['id'] . '/step', ['token' => $restore['token']]);
        $restore = $step->payload()['data']['restore'];
        self::assertSame('failed', $restore['status']);
        self::assertSame('backup.invalid_file', $restore['error']);
        self::assertSame(2, $this->rows('users'));
        self::assertFalse($this->setting('maintenance'));
        self::assertSame('failed', $admin->get('/admin/backup')->payload()['data']['restore']['status']);
    }

    public function testAssetsRoundTrip(): void
    {
        $storage = self::$root . '/storage';
        $u1 = '0a1b2c3d-1111-4222-8333-444455556666';
        $u2 = 'ffee0011-aaaa-4bbb-8ccc-ddddeeeeffff';
        $files = [
            'assets/0a/1b/' . $u1 . '.png' => random_bytes(70000),
            'assets/0a/1b/' . $u1 . '_thumb.webp' => random_bytes(3000),
            'assets/ff/ee/' . $u2 . '.jpg' => random_bytes(5000),
            'assets/readme.txt' => 'not an asset',
        ];
        foreach ($files as $rel => $data) {
            @mkdir(dirname($storage . '/' . $rel), 0777, true);
            file_put_contents($storage . '/' . $rel, $data);
        }
        $admin = $this->admin();
        $job = $this->backup($admin, 'assets');
        self::assertSame('done', $job['status'], json_encode($job));
        self::assertSame(4, $job['result']['count']);
        self::assertMatchesRegularExpression('/^jdr-assets-\d{8}-\d{6}\.zip$/', $job['result']['file_name']);
        $download = $admin->get('/jobs/' . $job['id'] . '/download');
        $zip = $download->contents();
        self::sent($download);
        self::wipe($storage . '/assets');

        $start = $admin->post('/admin/backup/restore/assets', ['upload_id' => $this->upload($admin, 'assets', $zip)]);
        self::assertSame(201, $start->status(), $start->body());
        $restored = $this->runJob($admin, $start->payload()['data']['job']);
        self::assertSame('done', $restored['status'], json_encode($restored));
        self::assertSame(3, $restored['result']['restored']);
        self::assertSame(0, $restored['result']['skipped']);
        self::assertSame(['assets/readme.txt'], $restored['result']['rejected_files']);
        foreach ($files as $rel => $data) {
            if ($rel !== 'assets/readme.txt') {
                self::assertSame($data, file_get_contents($storage . '/' . $rel), $rel);
            }
        }
        self::assertFileDoesNotExist($storage . '/assets/readme.txt');

        $again = $this->runJob($admin, $admin->post('/admin/backup/restore/assets', ['upload_id' => $this->upload($admin, 'assets', $zip)])->payload()['data']['job']);
        self::assertSame(['restored' => 0, 'skipped' => 3, 'rejected' => 1], array_intersect_key($again['result'], ['restored' => 0, 'skipped' => 0, 'rejected' => 0]));
    }

    /**
     * @return iterable<string, array{0: string, 1: int|null}>
     */
    public static function trappedEntries(): iterable
    {
        yield 'parent' => ['assets/../../evil.txt', null];
        yield 'absolute' => ['/tmp/jdr-evil.txt', null];
        yield 'link' => ['assets/0a/1b/0a1b2c3d-1111-4222-8333-444455556666.png', 0120777];
    }

    /**
     * @dataProvider trappedEntries
     */
    public function testTrappedArchiveIsRefused(string $name, ?int $mode): void
    {
        if (!class_exists(\ZipArchive::class)) {
            self::markTestSkipped('ZipArchive is needed to build the archive.');
        }
        $path = self::$root . '/storage/trap.zip';
        @unlink($path);
        $zip = new \ZipArchive();
        self::assertTrue($zip->open($path, \ZipArchive::CREATE));
        $zip->addFromString($name, '/etc/passwd');
        if ($mode !== null) {
            $zip->setExternalAttributesName($name, \ZipArchive::OPSYS_UNIX, $mode << 16);
        }
        $zip->addFromString('manifest-assets.json', (string) json_encode(['format' => 'jdr-assets-backup', 'version' => 1, 'files' => [
            ['uuid' => null, 'path' => $name, 'size' => 11, 'sha256' => hash('sha256', '/etc/passwd')],
        ]]));
        $zip->close();
        $admin = $this->admin();
        $response = $admin->post('/admin/backup/restore/assets', ['upload_id' => $this->upload($admin, 'assets', (string) file_get_contents($path))]);
        self::assertSame(422, $response->status(), $response->body());
        self::assertSame('backup.invalid_file', self::errorCode($response));
        self::assertFileDoesNotExist(self::$root . '/evil.txt');
        self::assertFileDoesNotExist('/tmp/jdr-evil.txt');
        self::assertFalse(is_link(self::$root . '/storage/assets/0a/1b/0a1b2c3d-1111-4222-8333-444455556666.png'));
        @unlink($path);
    }

    private function setting(string $key): mixed
    {
        $value = $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . ' WHERE `key` = ?', [$key]);

        return is_string($value) ? json_decode($value, true) : null;
    }
}
