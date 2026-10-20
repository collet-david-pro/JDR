<?php

declare(strict_types=1);

namespace JDR\Tests\Migrate;

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\ChecksumMismatchException;
use JDR\Migrate\Lock;
use JDR\Migrate\MigrationFailedException;
use JDR\Migrate\MigrationFile;
use JDR\Migrate\MigrationLockedException;
use JDR\Migrate\Runner;
use JDR\Migrate\SqlSplitter;
use JDR\Tests\Support\DbTestCase;

require_once __DIR__ . '/../Support/DbTestCase.php';

final class RunnerTest extends DbTestCase
{
    private const SETTINGS_DDL = "-- @idempotent-ddl\nCREATE TABLE IF NOT EXISTS `{{prefix}}settings` (
  `key` VARCHAR(100) NOT NULL, `value` JSON NOT NULL, `updated_at` DATETIME NOT NULL, PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;\n";

    private Db $db;
    /** @var list<string> */
    private array $dirs = [];

    protected function setUp(): void
    {
        $this->db = self::newDb();
        self::dropTestTables($this->db);
    }

    protected function tearDown(): void
    {
        foreach ($this->dirs as $dir) {
            self::removeDir($dir);
        }
        unset($GLOBALS['jdr_test_fail_at']);
        self::dropTestTables($this->db);
    }

    // ------------------------------------------------------------------
    // Real migrations
    // ------------------------------------------------------------------

    public function testFreshInstallCreatesEveryTable(): void
    {
        $log = new CallbackLogger();
        $runner = new Runner($this->db, self::migrationsDir(), $log);

        $pending = $runner->pending();
        self::assertSame('0001', $pending[0]['version']);
        self::assertSame('initial', $pending[0]['name']);
        self::assertSame('pending', $pending[0]['status']);

        $done = $runner->runAll();
        self::assertCount(self::realMigrationCount(), $done);
        self::assertSame('0001', $done[0]['version']);
        self::assertSame('applied', $done[0]['status']);

        foreach (self::SCHEMA_TABLES as $table) {
            self::assertTrue($this->db->tableExists($table), "Missing table $table");
        }
        self::assertSame([], $runner->pending());
        self::assertSame('"' . self::latestRealVersion() . '"', $this->settingValue('db_version'));
        self::assertSame(self::latestRealVersion(), $runner->currentVersion());

        $status = $runner->status();
        self::assertSame('applied', $status[0]['status']);
        self::assertTrue($status[0]['checksum_ok']);
        self::assertNull($status[0]['error']);
        self::assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/',
            (string) $status[0]['applied_at']
        );
        self::assertNotEmpty($log->entries());
    }

    public function testRunningTwiceIsHarmless(): void
    {
        $runner = new Runner($this->db, self::migrationsDir());
        self::assertCount(self::realMigrationCount(), $runner->runAll());

        $again = new Runner(self::newDb(), self::migrationsDir());
        self::assertSame([], $again->runAll());
        self::assertNull($again->runNext());
        self::assertSame([], $again->pending());
        self::assertSame(
            self::realMigrationCount(),
            $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('schema_migrations'))
        );
    }

    public function testInitialMigrationIsReplayableAfterPartialRun(): void
    {
        // Simulate an interrupted 0001: only the first 27 statements (including the ALTER) ran.
        $sql = (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql');
        $sql = str_replace('{{prefix}}', $this->db->prefix(), $sql);
        $statements = SqlSplitter::split($sql);
        foreach (array_slice($statements, 0, 27) as $statement) {
            $this->db->pdo()->exec($statement);
        }
        self::assertTrue($this->db->foreignKeyExists('games', 'fk_{{prefix}}games_world_map'));
        self::assertFalse($this->db->tableExists('processed_ops'));

        $log = new CallbackLogger();
        $runner = new Runner($this->db, self::migrationsDir(), $log);
        self::assertCount(self::realMigrationCount(), $runner->runAll());
        foreach (self::SCHEMA_TABLES as $table) {
            self::assertTrue($this->db->tableExists($table), "Missing table $table");
        }
        $skipped = array_filter($log->entries(), static fn (array $e): bool => str_contains($e['msg'], 'skipped'));
        self::assertCount(1, $skipped, 'The duplicate FK of the ALTER statement must be skipped');

        // Full replay of an already complete schema also succeeds.
        $this->db->execute('DELETE FROM ' . $this->db->t('schema_migrations'));
        self::assertCount(self::realMigrationCount(), (new Runner($this->db, self::migrationsDir()))->runAll());
    }

    private static function realMigrationCount(): int
    {
        return count(MigrationFile::discover(self::migrationsDir()));
    }

    private static function latestRealVersion(): string
    {
        $files = MigrationFile::discover(self::migrationsDir());

        return $files[count($files) - 1]->version;
    }

    // ------------------------------------------------------------------
    // Engine behaviour (fixture migrations)
    // ------------------------------------------------------------------

    public function testRunNextAppliesOneMigrationPerCall(): void
    {
        $dir = $this->fixtures([
            '0001_settings.sql' => self::SETTINGS_DDL,
            '0002_a.sql' => 'CREATE TABLE `{{prefix}}a` (id INT);',
            '0003_b.sql' => 'CREATE TABLE `{{prefix}}b` (id INT);',
        ]);
        $runner = new Runner($this->db, $dir);
        self::assertCount(3, $runner->pending());

        self::assertSame('0001', $runner->runNext()['version'] ?? null);
        self::assertSame('"0001"', $this->settingValue('db_version'));
        self::assertFalse($this->db->tableExists('a'));

        self::assertSame('0002', $runner->runNext()['version'] ?? null);
        self::assertTrue($this->db->tableExists('a'));
        self::assertFalse($this->db->tableExists('b'));
        self::assertSame('"0002"', $this->settingValue('db_version'));
        self::assertSame(['0003'], array_column($runner->pending(), 'version'));

        self::assertSame('0003', $runner->runNext()['version'] ?? null);
        self::assertSame('"0003"', $this->settingValue('db_version'));
        self::assertNull($runner->runNext());
    }

    public function testDbVersionIsSkippedWithoutSettingsTable(): void
    {
        $dir = $this->fixtures(['0001_a.sql' => 'CREATE TABLE `{{prefix}}a` (id INT);']);
        self::assertCount(1, (new Runner($this->db, $dir))->runAll());
        self::assertFalse($this->db->tableExists('settings'));
    }

    public function testPrefixPlaceholderIsReplaced(): void
    {
        $dir = $this->fixtures([
            '0001_prefix.sql' => "CREATE TABLE `{{prefix}}parent` (
  id BIGINT UNSIGNED NOT NULL, PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE `{{prefix}}child` (
  id BIGINT UNSIGNED NOT NULL, parent_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY (id),
  CONSTRAINT `fk_{{prefix}}child_parent` FOREIGN KEY (parent_id) REFERENCES `{{prefix}}parent` (id) ON DELETE CASCADE
) ENGINE=InnoDB;
INSERT INTO `{{prefix}}parent` (id) VALUES (1);",
        ]);
        (new Runner($this->db, $dir))->runAll();

        $p = $this->db->prefix();
        self::assertTrue($this->db->tableExists('parent'));
        self::assertTrue($this->db->tableExists('child'));
        self::assertTrue($this->db->foreignKeyExists('child', 'fk_' . $p . 'child_parent'));
        self::assertSame(1, $this->db->fetchValue('SELECT COUNT(*) FROM `' . $p . 'parent`'));
        self::assertSame(0, $this->db->fetchValue(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '%{{%'"
        ));
    }

    public function testFailedMigrationIsRecordedThenRetried(): void
    {
        $dir = $this->fixtures([
            '0001_ok.sql' => self::SETTINGS_DDL,
            '0002_partial.sql' => "CREATE TABLE IF NOT EXISTS `{{prefix}}t1` (id INT);
INSERT INTO `{{prefix}}missing_table` VALUES (1);
CREATE TABLE IF NOT EXISTS `{{prefix}}t2` (id INT);",
        ]);
        $runner = new Runner($this->db, $dir);
        try {
            $runner->runAll();
            self::fail('MigrationFailedException expected');
        } catch (MigrationFailedException $e) {
            self::assertSame('0002', $e->version);
            self::assertSame('partial', $e->name);
            self::assertStringContainsString('missing_table', $e->getMessage());
            self::assertInstanceOf(\Throwable::class, $e->getPrevious());
        }

        // Partial effect: t1 created, t2 not. 0001 applied, 0002 failed.
        self::assertTrue($this->db->tableExists('t1'));
        self::assertFalse($this->db->tableExists('t2'));
        $status = array_column($runner->status(), null, 'version');
        self::assertSame('applied', $status['0001']['status']);
        self::assertSame('failed', $status['0002']['status']);
        self::assertStringContainsString('statement #2', (string) $status['0002']['error']);
        self::assertSame('"0001"', $this->settingValue('db_version'));

        $pending = (new Runner($this->db, $dir))->pending();
        self::assertSame(['0002'], array_column($pending, 'version'));
        self::assertSame('failed', $pending[0]['status']);
        self::assertNotNull($pending[0]['error']);

        // Retrying without a fix fails again, and keeps the "failed" status.
        try {
            (new Runner($this->db, $dir))->runNext();
            self::fail('MigrationFailedException expected');
        } catch (MigrationFailedException) {
        }

        // A failed migration may be fixed (checksum change accepted) and retried.
        file_put_contents($dir . '/0002_partial.sql', "CREATE TABLE IF NOT EXISTS `{{prefix}}t1` (id INT);
CREATE TABLE IF NOT EXISTS `{{prefix}}missing_table` (id INT);
INSERT INTO `{{prefix}}missing_table` VALUES (1);
CREATE TABLE IF NOT EXISTS `{{prefix}}t2` (id INT);");
        $result = (new Runner($this->db, $dir))->runNext();
        self::assertSame('0002', $result['version'] ?? null);
        self::assertTrue($this->db->tableExists('t2'));

        $status = array_column((new Runner($this->db, $dir))->status(), null, 'version');
        self::assertSame('applied', $status['0002']['status']);
        self::assertNull($status['0002']['error']);
        self::assertTrue($status['0002']['checksum_ok']);
        self::assertSame('"0002"', $this->settingValue('db_version'));
    }

    public function testPhpMigrationResumesAfterPartialFailure(): void
    {
        $dir = $this->fixtures([
            '0001_table.sql' => 'CREATE TABLE IF NOT EXISTS `{{prefix}}items` (id INT NOT NULL, PRIMARY KEY (id));',
            '0002_fill.php' => <<<'PHP'
<?php

declare(strict_types=1);

use JDR\Core\Db;
use JDR\Migrate\Migration;
use JDR\Migrate\MigrationLogger;

defined('JDR_BOOT') || exit;

return new class implements Migration {
    public function up(Db $db, MigrationLogger $log): void
    {
        // Resumable batch: cursor = highest id already inserted.
        $start = (int) $db->fetchValue('SELECT COALESCE(MAX(id), 0) FROM ' . $db->t('items')) + 1;
        for ($id = $start; $id <= 10; $id++) {
            if (isset($GLOBALS['jdr_test_fail_at']) && $id === $GLOBALS['jdr_test_fail_at']) {
                throw new \RuntimeException('simulated crash at ' . $id);
            }
            $db->execute('INSERT INTO ' . $db->t('items') . ' (id) VALUES (?)', [$id]);
        }
        $log->info('filled', ['from' => $start]);
    }
};
PHP,
        ]);

        $GLOBALS['jdr_test_fail_at'] = 6;
        try {
            (new Runner($this->db, $dir))->runAll();
            self::fail('MigrationFailedException expected');
        } catch (MigrationFailedException $e) {
            self::assertStringContainsString('simulated crash at 6', $e->getMessage());
        }
        self::assertSame(5, $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('items')));

        unset($GLOBALS['jdr_test_fail_at']);
        $log = new CallbackLogger();
        $done = (new Runner($this->db, $dir, $log))->runAll();
        self::assertSame(['0002'], array_column($done, 'version'));
        self::assertSame(10, $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('items')));
        $filled = array_values(array_filter($log->entries(), static fn (array $e): bool => $e['msg'] === 'filled'));
        self::assertSame(['from' => 6], $filled[0]['ctx']);
    }

    public function testPhpMigrationMustReturnAMigration(): void
    {
        $dir = $this->fixtures(['0001_bad.php' => "<?php\nreturn 42;\n"]);
        $this->expectException(MigrationFailedException::class);
        $this->expectExceptionMessage('must return an instance of');
        (new Runner($this->db, $dir))->runAll();
    }

    public function testModifiedAppliedMigrationIsRefused(): void
    {
        $dir = $this->fixtures([
            '0001_a.sql' => 'CREATE TABLE `{{prefix}}a` (id INT);',
        ]);
        (new Runner($this->db, $dir))->runAll();

        file_put_contents($dir . '/0001_a.sql', 'CREATE TABLE `{{prefix}}a` (id BIGINT);');
        file_put_contents($dir . '/0002_b.sql', 'CREATE TABLE `{{prefix}}b` (id INT);');

        $runner = new Runner($this->db, $dir);
        foreach (['pending', 'runNext', 'runAll'] as $method) {
            try {
                $runner->{$method}();
                self::fail("ChecksumMismatchException expected from $method()");
            } catch (ChecksumMismatchException $e) {
                self::assertSame('0001', $e->version);
                self::assertNotSame($e->expected, $e->actual);
                self::assertStringContainsString('modified', $e->getMessage());
            }
        }
        self::assertFalse($this->db->tableExists('b'), 'Nothing must run after a checksum mismatch');

        // status() never throws: it reports the mismatch.
        $status = array_column($runner->status(), null, 'version');
        self::assertFalse($status['0001']['checksum_ok']);
        self::assertSame('pending', $status['0002']['status']);
    }

    public function testLineEndingChangeIsNotAModification(): void
    {
        $dir = $this->fixtures(['0001_a.sql' => "CREATE TABLE `{{prefix}}a` (id INT);\n-- end\n"]);
        (new Runner($this->db, $dir))->runAll();
        file_put_contents($dir . '/0001_a.sql', "CREATE TABLE `{{prefix}}a` (id INT);\r\n-- end\r\n");
        self::assertSame([], (new Runner($this->db, $dir))->pending());
    }

    public function testIdempotentMarkerIgnoresAlreadyExistingObjects(): void
    {
        $body = "CREATE TABLE `{{prefix}}x` (id BIGINT UNSIGNED NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB;
CREATE TABLE `{{prefix}}x` (id INT);
ALTER TABLE `{{prefix}}x` ADD COLUMN c INT NULL;
ALTER TABLE `{{prefix}}x` ADD COLUMN c INT NULL;
ALTER TABLE `{{prefix}}x` ADD INDEX idx_c (c);
ALTER TABLE `{{prefix}}x` ADD INDEX idx_c (c);
ALTER TABLE `{{prefix}}x` ADD COLUMN parent_id BIGINT UNSIGNED NULL;
ALTER TABLE `{{prefix}}x` ADD CONSTRAINT `fk_{{prefix}}x_parent` FOREIGN KEY (parent_id)
  REFERENCES `{{prefix}}x` (id) ON DELETE SET NULL;
ALTER TABLE `{{prefix}}x` ADD CONSTRAINT `fk_{{prefix}}x_parent` FOREIGN KEY (parent_id)
  REFERENCES `{{prefix}}x` (id) ON DELETE SET NULL;
ALTER TABLE `{{prefix}}x` DROP COLUMN never_existed;
ALTER TABLE `{{prefix}}x` DROP INDEX idx_never_existed;
";
        $dir = $this->fixtures(['0001_idem.sql' => "-- @idempotent-ddl\n" . $body]);
        $log = new CallbackLogger();
        self::assertCount(1, (new Runner($this->db, $dir, $log))->runAll());
        self::assertTrue($this->db->columnExists('x', 'c'));
        self::assertTrue($this->db->indexExists('x', 'idx_c'));
        self::assertTrue($this->db->foreignKeyExists('x', 'fk_{{prefix}}x_parent'));
        $skipped = array_filter($log->entries(), static fn (array $e): bool => str_contains($e['msg'], 'skipped'));
        self::assertCount(6, $skipped);
    }

    public function testWithoutMarkerAlreadyExistingObjectsFail(): void
    {
        $dir = $this->fixtures(['0001_strict.sql' => "CREATE TABLE `{{prefix}}x` (id INT);
ALTER TABLE `{{prefix}}x` ADD COLUMN c INT NULL;
ALTER TABLE `{{prefix}}x` ADD COLUMN c INT NULL;"]);
        try {
            (new Runner($this->db, $dir))->runAll();
            self::fail('MigrationFailedException expected');
        } catch (MigrationFailedException $e) {
            self::assertStringContainsString('statement #3', $e->getMessage());
        }
    }

    public function testMarkerDoesNotHideRealErrors(): void
    {
        $dir = $this->fixtures([
            '0001_err.sql' => "-- @idempotent-ddl\nCREATE TABLE `{{prefix}}x` (id INT);\n"
                . 'SELECT nope FROM `{{prefix}}x`;',
        ]);
        $this->expectException(MigrationFailedException::class);
        (new Runner($this->db, $dir))->runAll();
    }

    public function testLockPreventsConcurrentRuns(): void
    {
        $dir = $this->fixtures(['0001_a.sql' => 'CREATE TABLE `{{prefix}}a` (id INT);']);

        $other = new Lock(self::newDb());
        self::assertStringContainsString($this->db->prefix(), $other->name());
        self::assertLessThanOrEqual(64, strlen($other->name()));
        self::assertTrue($other->acquire());

        $runner = new Runner($this->db, $dir);
        foreach (['runNext', 'runAll'] as $method) {
            try {
                $runner->{$method}();
                self::fail("MigrationLockedException expected from $method()");
            } catch (MigrationLockedException $e) {
                self::assertStringContainsString('in progress', $e->getMessage());
            }
        }
        self::assertFalse($this->db->tableExists('a'));

        $other->release();
        self::assertSame('0001', $runner->runNext()['version'] ?? null);

        // The runner released its lock: another connection can take it.
        $third = new Lock(self::newDb());
        self::assertTrue($third->acquire());
        $third->release();
    }

    public function testLockIsReleasedAfterFailure(): void
    {
        $dir = $this->fixtures(['0001_err.sql' => 'SELECT nope;']);
        try {
            (new Runner($this->db, $dir))->runNext();
        } catch (MigrationFailedException) {
        }
        $lock = new Lock(self::newDb());
        self::assertTrue($lock->acquire());
        $lock->release();
    }

    public function testStatusReportsMissingFiles(): void
    {
        $dir = $this->fixtures([
            '0001_a.sql' => 'CREATE TABLE `{{prefix}}a` (id INT);',
            '0002_b.sql' => 'CREATE TABLE `{{prefix}}b` (id INT);',
        ]);
        (new Runner($this->db, $dir))->runAll();
        unlink($dir . '/0002_b.sql');
        $status = array_column((new Runner($this->db, $dir))->status(), null, 'version');
        self::assertFalse($status['0001']['file_missing']);
        self::assertTrue($status['0002']['file_missing']);
        self::assertSame('applied', $status['0002']['status']);
    }

    public function testSchemaMigrationsBootstrapMatchesInitialMigration(): void
    {
        $initial = SqlSplitter::split((string) file_get_contents(self::migrationsDir() . '/0001_initial.sql'))[0];
        $normalize = static fn (string $s): string => (string) preg_replace('/\s+/', ' ', trim($s));
        self::assertSame($normalize(Runner::schemaMigrationsDdl('{{prefix}}')), $normalize($initial));
    }

    // ------------------------------------------------------------------

    /**
     * @param array<string, string> $files
     */
    private function fixtures(array $files): string
    {
        $dir = self::makeMigrationsDir($files);
        $this->dirs[] = $dir;

        return $dir;
    }

    private function settingValue(string $key): mixed
    {
        return $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . ' WHERE `key` = ?', [$key]);
    }
}
