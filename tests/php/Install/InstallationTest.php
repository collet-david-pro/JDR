<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Core\Db;
use JDR\Domain\Auth\Passwords;
use JDR\Install\ConfigWriter;
use JDR\Install\Env;
use JDR\Install\Installation;
use JDR\Install\State;
use JDR\Migrate\MigrationFile;
use JDR\Migrate\Runner;

/**
 * Step 5 end to end on the test database, including interruptions and the manual config.php path.
 */
final class InstallationTest extends InstallDbTestCase
{
    private const PASSWORD = 'Une-phrase-de-passe 42';

    private Db $db;
    private string $root;

    protected function setUp(): void
    {
        $this->db = self::installDb();
        self::dropTestTables($this->db);
        $this->root = TempRoot::create(true);
    }

    protected function tearDown(): void
    {
        @chmod($this->root, 0700);
        TempRoot::remove($this->root);
        self::dropTestTables($this->db);
    }

    private function state(string $mode = 'fresh'): State
    {
        return State::memory([
            'req' => ['ok' => true, 'routing_mode' => 'rewrite', 'https' => true],
            'db' => self::installDbConfig() + ['mode' => $mode, 'existing' => 0],
            'site' => [
                'site_name' => 'Ma table', 'base_url' => 'https://example.org/jdr', 'default_locale' => 'fr',
                'registration_mode' => 'invite', 'default_quota_bytes' => 100 * 1048576,
                'max_upload_bytes' => 5 * 1048576, 'max_dimension_px' => 2048, 'storage' => 'default',
                'storage_custom' => '', 'storage_path' => null,
            ],
            'admin' => ['email' => 'admin@example.org', 'username' => 'Admin', 'password_hash' => Passwords::hash(self::PASSWORD)],
            'run' => Installation::initial(),
        ]);
    }

    private function installation(State $state): Installation
    {
        return new Installation(new Env($this->root, ['HTTP_HOST' => 'example.org', 'SCRIPT_NAME' => '/jdr/install.php']), $state);
    }

    /**
     * @return list<array{phase:string, log:list<string>, error:?string, progress:array{done:int,total:int}}>
     */
    private function runUntil(State $state, string $phase, int $max = 30): array
    {
        $results = [];
        for ($i = 0; $i < $max; $i++) {
            $r = $this->installation($state)->run();
            self::assertNull($r['error'], (string) $r['error']);
            $results[] = $r;
            if ($r['phase'] === $phase) {
                return $results;
            }
        }
        self::fail('Phase ' . $phase . ' not reached');
    }

    private function settingValue(string $key): mixed
    {
        $v = $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . ' WHERE `key` = ?', [$key]);

        return $v === null ? null : json_decode((string) $v, true);
    }

    public function testFullRunOneMigrationPerRequest(): void
    {
        $state = $this->state();
        $results = $this->runUntil($state, 'done');
        $migrations = count(MigrationFile::discover(self::migrationsDir()));

        // start, one request per migration, the "nothing left" request, site, storage, config, lock.
        self::assertCount(1 + $migrations + 1 + 4, $results);
        $done = array_column(array_column($results, 'progress'), 'done');
        self::assertSame(end($results)['progress']['total'], end($results)['progress']['done']);
        for ($i = 1; $i < count($done); $i++) {
            self::assertGreaterThanOrEqual($done[$i - 1], $done[$i]);
        }

        // Database: schema, seed, site settings (step 3 wins over the seed), admin.
        self::assertSame(\REQUIRED_DB_VERSION, (new Runner($this->db, self::migrationsDir()))->currentVersion());
        self::assertSame('Ma table', $this->settingValue('site_name'));
        self::assertSame('invite', $this->settingValue('registration_mode'));
        self::assertSame(100 * 1048576, $this->settingValue('default_quota_bytes'));
        self::assertSame(2048, $this->settingValue('max_dimension_px'));
        self::assertSame('https://example.org/jdr', $this->settingValue('base_url'));
        self::assertSame(16777216, $this->settingValue('max_total_pixels'));
        $admin = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('users'));
        self::assertNotNull($admin);
        self::assertSame('admin', $admin['role']);
        self::assertSame('active', $admin['status']);
        self::assertTrue(Passwords::verify(self::PASSWORD, (string) $admin['password_hash']));
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('audit_log')));

        // Files: config.php, storage tree + protections, lock.
        $config = ConfigWriter::read($this->root . '/config.php');
        self::assertIsArray($config);
        self::assertEquals(self::installDbConfig(), $config['db']);
        self::assertSame('rewrite', $config['routing_mode']);
        self::assertSame('https://example.org/jdr', $config['base_url']);
        self::assertTrue($config['cookie_secure']);
        self::assertFalse($config['debug']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{128}$/', $config['app_secret']);
        self::assertSame(0640, fileperms($this->root . '/config.php') & 0777);
        foreach (['.htaccess', 'index.php', 'install.lock', 'assets', 'backups', 'logs', 'tmp', 'cache/ch', 'locks'] as $p) {
            self::assertFileExists($this->root . '/storage/' . $p);
        }

        // The clear password is nowhere: state, database dump, files.
        $haystack = json_encode($state->get('run'), JSON_THROW_ON_ERROR) . json_encode($state->get('admin'), JSON_THROW_ON_ERROR);
        foreach (['users', 'settings', 'audit_log'] as $table) {
            $haystack .= json_encode($this->db->fetchAll('SELECT * FROM ' . $this->db->t($table)), JSON_THROW_ON_ERROR);
        }
        $haystack .= (string) file_get_contents($this->root . '/config.php');
        self::assertStringNotContainsString(self::PASSWORD, $haystack);
    }

    public function testInterruptedRunResumesWithTheSameState(): void
    {
        $state = $this->state();
        $this->installation($state)->run(); // start
        $first = $this->installation($state)->run(); // 0001
        self::assertSame('migrate', $first['phase']);
        self::assertSame('0001', (new Runner($this->db, self::migrationsDir()))->currentVersion());

        // The browser comes back later: the next request goes on with 0002.
        $this->runUntil($state, 'done');
        self::assertSame(\REQUIRED_DB_VERSION, (new Runner($this->db, self::migrationsDir()))->currentVersion());
    }

    public function testInterruptedRunResumesFromANewSession(): void
    {
        $old = $this->state();
        $this->installation($old)->run();
        $this->installation($old)->run(); // only 0001 applied, then the session is lost

        $new = $this->state('resume');
        $this->runUntil($new, 'done');
        self::assertSame(\REQUIRED_DB_VERSION, (new Runner($this->db, self::migrationsDir()))->currentVersion());
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('users')));
    }

    public function testReplayingTheSitePhaseUpdatesTheAdminInsteadOfDuplicatingIt(): void
    {
        $state = $this->state();
        $this->runUntil($state, 'storage');
        $run = (array) $state->get('run');
        $run['phase'] = 'site'; // e.g. the request died after the commit
        $state->set('run', $run);
        $r = $this->installation($state)->run();
        self::assertNull($r['error']);
        self::assertStringContainsString('mis à jour', (string) end($r['log']));
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('users')));
    }

    public function testOverwriteDropsExistingTablesFirst(): void
    {
        (new Runner($this->db, self::migrationsDir()))->runAll();
        $now = gmdate('Y-m-d H:i:s');
        $this->db->execute('INSERT INTO ' . $this->db->t('users')
            . " (email, username, password_hash, created_at, updated_at) VALUES ('old@x.fr', 'old', '\$x', ?, ?)", [$now, $now]);

        $state = $this->state('overwrite');
        $results = $this->runUntil($state, 'done');
        self::assertStringContainsString('supprimée', $results[0]['log'][0]);
        self::assertSame(['admin@example.org'], array_column(
            $this->db->fetchAll('SELECT email FROM ' . $this->db->t('users')),
            'email'
        ));
    }

    public function testUnwritableRootWaitsForAManualConfig(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root ignores permissions');
        }
        $state = $this->state();
        $this->runUntil($state, 'storage');
        $this->installation($state)->run(); // storage -> config
        chmod($this->root, 0500);
        $r = $this->installation($state)->run();
        self::assertSame('await_config', $r['phase']);
        self::assertFileDoesNotExist($this->root . '/config.php');
        $content = $this->installation($state)->configContent();
        self::assertStringContainsString("'app_secret' =>", $content);

        // Still waiting while the file is absent.
        self::assertSame('await_config', $this->installation($state)->run()['phase']);

        // A foreign config.php is refused.
        chmod($this->root, 0700);
        file_put_contents($this->root . '/config.php', ConfigWriter::render([
            'db' => self::installDbConfig(), 'base_url' => 'https://x', 'routing_mode' => 'query', 'storage_path' => null,
            'app_secret' => str_repeat('b', 128), 'cron_key' => 'k', 'cookie_secure' => false,
        ]));
        $foreign = $this->installation($state)->run();
        self::assertNotNull($foreign['error']);
        self::assertSame('await_config', $foreign['phase']);

        // The user uploads the shown content: the run goes on.
        file_put_contents($this->root . '/config.php', $content);
        $this->runUntil($state, 'done');
        self::assertFileExists($this->root . '/storage/install.lock');
    }
}
