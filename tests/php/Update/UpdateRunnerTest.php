<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Clock;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Update\UpdateChecker;
use JDR\Domain\Update\UpdatePackage;
use JDR\Domain\Update\UpdateRunner;
use JDR\Domain\Update\UpdateStorage;
use JDR\Tests\Api\ApiTestCase;

/**
 * End to end on a temporary installation (never on this repository): files, test database, backups.
 */
final class UpdateRunnerTest extends ApiTestCase
{
    private const PROBE = "CREATE TABLE `{{prefix}}update_probe` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;\n"
        . "INSERT INTO `{{prefix}}update_probe` (`id`) VALUES (1);\n";

    private string $install;
    private UpdateStorage $storage;
    /** @var array<string, string> */
    private array $before;

    protected function setUp(): void
    {
        parent::setUp();
        $this->db->pdo()->exec('DROP TABLE IF EXISTS ' . $this->db->t('update_probe'));
        // schema_migrations survives the truncation between tests: forget the probe migration.
        $this->db->execute('DELETE FROM ' . $this->db->t('schema_migrations') . " WHERE `version` >= '0005'");
        Fixture::markRealMigrationsApplied($this->db);
        $this->createUser('Keeper', 'admin');
        $this->install = Fixture::install(Fixture::oldFiles() + Fixture::realMigrations());
        $this->storage = UpdateStorage::for($this->install, $this->install . '/storage');
        $this->before = Fixture::snapshot($this->install);
    }

    protected function tearDown(): void
    {
        Fixture::remove($this->install);
        $this->db->pdo()->exec('DROP TABLE IF EXISTS ' . $this->db->t('update_probe'));
    }

    /**
     * @return array<string, string>
     */
    private static function release(string $migration = self::PROBE): array
    {
        return Fixture::newFiles() + Fixture::realMigrations() + ['migrations/0005_probe.sql' => $migration];
    }

    private function runner(?\Closure $beforeWrite = null): UpdateRunner
    {
        $clock = new Clock();
        $settings = new Settings($this->db, $clock);
        $checker = new UpdateChecker($settings, $clock, new FakeReleaseHttp(), '0.1.0');
        $packages = new UpdatePackage($this->storage, $checker, $this->db, $clock, '0.1.0');

        return new UpdateRunner($this->storage, $packages, $settings, $this->db, $clock, new AuditLog($this->db, $clock), '0.1.0', $beforeWrite);
    }

    private function prepare(string $migration = self::PROBE): string
    {
        $runner = $this->runner();
        $zip = Fixture::zip($this->install . '/storage', self::release($migration), '0.2.0');
        $clock = new Clock();
        $packages = new UpdatePackage($this->storage, new UpdateChecker(new Settings($this->db, $clock), $clock, new FakeReleaseHttp(), '0.1.0'), $this->db, $clock, '0.1.0');
        $summary = $packages->accept($zip, 1);

        return (string) $runner->prepare($summary['id'], 1, true)['id'];
    }

    /**
     * One fresh runner per call, like one HTTP request each.
     *
     * @param (\Closure(array<string, mixed>, int): void)|null $each
     * @return array<string, mixed>
     */
    private function runToEnd(string $id, float $budget = 5.0, ?\Closure $beforeWrite = null, ?\Closure $each = null): array
    {
        for ($i = 0; $i < 2000; $i++) {
            $s = $this->runner($beforeWrite)->step($id, $budget);
            if ($each !== null) {
                $each($s, $i);
            }
            if (in_array($s['state'], ['done', 'failed', 'restored', 'failed_migration'], true)) {
                return $s;
            }
        }
        self::fail('The run never ended.');
    }

    private function setting(string $key): mixed
    {
        $value = $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . ' WHERE `key` = ?', [$key]);

        return $value === null ? null : json_decode((string) $value, true);
    }

    private function assertUpdated(array $s): void
    {
        self::assertSame('done', $s['state'], (string) $s['error']);
        $expected = self::release();
        $snapshot = Fixture::snapshot($this->install);
        foreach ($expected as $path => $content) {
            self::assertSame(hash('sha256', $content), $snapshot[$path] ?? null, $path);
        }
        self::assertArrayNotHasKey('app/Old/Gone.php', $snapshot);
        self::assertDirectoryDoesNotExist($this->install . '/app/Old');
        $keys = array_merge(array_keys($expected), ['manifest.json']);
        sort($keys);
        self::assertSame($keys, array_keys($snapshot), 'exactly the new files, no stray temporary file');
        self::assertSame('0.2.0', json_decode((string) file_get_contents($this->install . '/manifest.json'), true)['version']);
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('update_probe')));
        self::assertSame('applied', $this->db->fetchValue('SELECT `status` FROM ' . $this->db->t('schema_migrations') . " WHERE `version` = '0005'"));
        self::assertSame('0.2.0', $this->setting('app_version'));
        self::assertSame(['0005'], $s['migrations']);
        self::assertFileDoesNotExist($this->storage->runDir($s['id']) . '/package.zip');
        self::assertDirectoryDoesNotExist($this->storage->runDir($s['id']) . '/rollback');
        self::assertSame(1, $this->rows('audit_log', "`action` = 'update.applied'"));
        self::assertSame(1, $this->rows('audit_log', "`action` = 'update.started'"));
    }

    public function testSuccessfulUpdate(): void
    {
        $id = $this->prepare();
        $s = $this->runToEnd($id);
        $this->assertUpdated($s);
        self::assertFalse($this->setting('maintenance'));

        // The SQL backup exists and is readable SQL covering the prefixed tables.
        $backup = $this->storage->backupsDir() . '/' . $s['backup']['file'];
        self::assertFileExists($backup);
        self::assertMatchesRegularExpression('/^jdr-\d{8}-\d{6}-v0\.1\.0\.sql\.gz$/', $s['backup']['file']);
        $sql = implode('', gzfile($backup) ?: []);
        self::assertStringContainsString('CREATE TABLE `' . $this->db->prefix() . 'users`', $sql);
        self::assertStringContainsString("'Keeper'", $sql);
        self::assertStringNotContainsString('update_probe', $sql, 'taken before the migrations');
        self::assertStringEndsWith("-- end\n", $sql);

        // Nothing left to do afterwards.
        self::assertNull($this->runner()->diskStatus(\REQUIRED_DB_VERSION));
    }

    public function testMaintenanceFlagIsRestoredToItsInitialValue(): void
    {
        $this->setSetting('maintenance', true);
        $this->assertUpdated($this->runToEnd($this->prepare()));
        self::assertTrue($this->setting('maintenance'));
    }

    public function testWriteFailureDuringCopyRollsBackExactly(): void
    {
        foreach (['app/New/Added.php', 'app/Old/Gone.php'] as $failOn) {
            $id = $this->prepare();
            $fault = static function (string $path) use ($failOn): void {
                if ($path === $failOn) {
                    throw new \RuntimeException('disk full (simulated)');
                }
            };
            $s = $this->runToEnd($id, 5.0, $fault);
            self::assertSame('failed', $s['state'], $failOn);
            self::assertStringContainsString('disk full (simulated)', (string) $s['error']);
            self::assertSame($this->before, Fixture::snapshot($this->install), 'files exactly as before (' . $failOn . ')');
            self::assertFalse($this->setting('maintenance'));
            self::assertNull($this->setting('app_version'));
            self::assertFalse($this->db->tableExists('update_probe'));
        }
    }

    public function testFailedMigrationRetryThenRestore(): void
    {
        $bad = "CREATE TABLE `{{prefix}}update_probe` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;\nTHIS IS NOT SQL;\n";
        $id = $this->prepare($bad);
        $s = $this->runToEnd($id);
        self::assertSame('failed_migration', $s['state']);
        self::assertNotNull($s['error']);
        self::assertTrue($this->setting('maintenance'), 'maintenance kept after a failed migration');
        self::assertSame(hash('sha256', "<?php // front controller v2\n"), Fixture::snapshot($this->install)['index.php']);

        $this->runner()->retry($id);
        $s = $this->runToEnd($id);
        self::assertSame('failed_migration', $s['state'], 'still failing');

        $this->runner()->restore($id);
        $s = $this->runToEnd($id);
        self::assertSame('restored', $s['state'], (string) $s['error']);
        self::assertSame($this->before, Fixture::snapshot($this->install), 'files back');
        self::assertFalse($this->db->tableExists('update_probe'), 'table created by the failed migration dropped');
        self::assertNull($this->db->fetchValue('SELECT `status` FROM ' . $this->db->t('schema_migrations') . " WHERE `version` = '0005'"));
        self::assertSame(1, $this->rows('users', "`username` = 'Keeper'"));
        self::assertFalse($this->setting('maintenance'));
        self::assertNull($this->setting('app_version'));
    }

    public function testRetrySucceedsOnceTheCauseIsFixed(): void
    {
        $id = $this->prepare("THIS IS NOT SQL;\n");
        self::assertSame('failed_migration', $this->runToEnd($id)['state']);
        file_put_contents($this->install . '/migrations/0005_probe.sql', self::PROBE);
        $this->runner()->retry($id);
        $s = $this->runToEnd($id);
        self::assertSame('done', $s['state'], (string) $s['error']);
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('update_probe')));
    }

    public function testResumesAfterInterruptions(): void
    {
        $id = $this->prepare();
        $file = $this->storage->runDir($id) . '/state.json';
        $rewound = [];
        $backupCursor = null;
        $s = $this->runToEnd($id, 0.0, null, function (array $s) use ($file, &$rewound, &$backupCursor): void {
            // A request killed after its work but before saving its state: the previous cursor comes back.
            if ($s['step'] === 'backup_db' && is_array($s['backup']) && !$s['backup']['done']) {
                if ($backupCursor === null && $s['backup']['table'] >= 3) {
                    $backupCursor = $s['backup'];
                } elseif ($backupCursor !== null && !isset($rewound['backup_db']) && $s['backup']['table'] >= 6) {
                    $rewound['backup_db'] = true;
                    $s['backup'] = $backupCursor;
                    file_put_contents($file, json_encode($s));
                }
            }
            foreach (['backup_files', 'copy'] as $step) {
                if ($s['step'] === $step && $s['cursor'] >= 3 && !isset($rewound[$step])) {
                    $rewound[$step] = true;
                    $s['cursor'] -= 2;
                    file_put_contents($file, json_encode($s));
                }
            }
        });
        self::assertSame(['backup_db' => true, 'backup_files' => true, 'copy' => true], $rewound + ['backup_db' => false]);
        $this->assertUpdated($s);
        $sql = implode('', gzfile($this->storage->backupsDir() . '/' . $s['backup']['file']) ?: []);
        self::assertSame(count($s['backup']['tables']), substr_count($sql, "\nCREATE TABLE "), 'each table dumped once');
        self::assertSame(1, substr_count($sql, 'INSERT INTO `' . $this->db->prefix() . 'users`'));
    }

    public function testStepWhileLockedReportsBusy(): void
    {
        $id = $this->prepare();
        $lock = fopen($this->storage->runDir($id) . '/lock', 'c');
        self::assertNotFalse($lock);
        flock($lock, LOCK_EX);
        $s = $this->runner()->step($id);
        self::assertTrue($s['busy']);
        self::assertSame('ready', $s['state']);
        flock($lock, LOCK_UN);
        fclose($lock);
        $this->assertUpdated($this->runToEnd($id));
    }
}
