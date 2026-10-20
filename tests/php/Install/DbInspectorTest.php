<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Core\Db;
use JDR\Install\Check;
use JDR\Install\DbInspector;
use JDR\Migrate\Runner;
use PHPUnit\Framework\Attributes\DataProvider;

final class DbInspectorTest extends InstallDbTestCase
{
    private Db $db;

    protected function setUp(): void
    {
        $this->db = self::installDb();
        self::dropTestTables($this->db);
    }

    protected function tearDown(): void
    {
        self::dropTestTables($this->db);
    }

    /**
     * @param list<Check> $checks
     */
    private static function byId(array $checks, string $id): Check
    {
        foreach ($checks as $check) {
            if ($check->id === $id) {
                return $check;
            }
        }
        self::fail('Missing check ' . $id);
    }

    public function testEmptyPrefixPassesEveryCheckAndLeavesNoProbeTable(): void
    {
        $result = (new DbInspector())->inspect(self::installDbConfig());

        self::assertTrue($result['ok'], print_r(array_map(static fn (Check $c) => $c->toArray(), $result['checks']), true));
        self::assertSame([], $result['existing']);
        self::assertFalse($result['resumable']);
        foreach (['db_connect', 'db_version', 'db_exists', 'db_innodb', 'db_privileges', 'db_clock'] as $id) {
            self::assertSame(Check::OK, self::byId($result['checks'], $id)->status, $id);
        }
        self::assertSame([], self::testTables($this->db), 'probe tables must be dropped');
    }

    public function testWrongPasswordIsReportedWithoutLeakingIt(): void
    {
        $cfg = ['pass' => 'wr0ng-Pa55-xyz', 'user' => 'jdr_nobody_' . bin2hex(random_bytes(3))] + self::installDbConfig();
        $result = (new DbInspector())->inspect($cfg);

        self::assertFalse($result['ok']);
        $check = self::byId($result['checks'], 'db_connect');
        self::assertSame(Check::ERROR, $check->status);
        self::assertSame('db.connect.denied', $check->hint);
        self::assertStringNotContainsString('wr0ng-Pa55-xyz', json_encode($check->toArray(), JSON_THROW_ON_ERROR));
    }

    public function testExistingInstallationIsDetectedAsResumable(): void
    {
        (new Runner($this->db, self::migrationsDir()))->runNext();
        $result = (new DbInspector())->inspect(self::installDbConfig());

        self::assertTrue($result['ok']);
        self::assertContains(self::PREFIX . 'schema_migrations', $result['existing']);
        self::assertContains(self::PREFIX . 'users', $result['existing']);
        self::assertTrue($result['resumable']);
    }

    public function testForeignTablesAreNotResumable(): void
    {
        $this->db->pdo()->exec('CREATE TABLE ' . self::PREFIX . 'something (id INT)');
        $result = (new DbInspector())->inspect(self::installDbConfig());

        self::assertSame([self::PREFIX . 'something'], $result['existing']);
        self::assertFalse($result['resumable']);
    }

    public function testDropPrefixedOnlyTouchesThePrefix(): void
    {
        (new Runner($this->db, self::migrationsDir()))->runNext();
        $other = new Db(['prefix' => 'jdrj_'] + self::dbConfig());
        $other->pdo()->exec('CREATE TABLE jdrj_keep (id INT)');
        try {
            $pdo = $this->db->pdo();
            $dropped = DbInspector::dropPrefixed($pdo, self::PREFIX);
            self::assertContains(self::PREFIX . 'users', $dropped);
            self::assertSame([], DbInspector::existingTables($pdo, self::PREFIX));
            self::assertTrue($other->tableExists('keep'));
        } finally {
            $other->pdo()->exec('DROP TABLE IF EXISTS jdrj_keep');
        }
    }

    public function testMissingDatabaseNeedsTheCreateOption(): void
    {
        $name = 'jdr_test_inst_' . bin2hex(random_bytes(3));
        $cfg = ['name' => $name] + self::installDbConfig();
        try {
            $refused = (new DbInspector())->inspect($cfg);
            self::assertFalse($refused['ok']);
            self::assertSame('db.exists.missing', self::byId($refused['checks'], 'db_exists')->hint);

            $created = (new DbInspector())->inspect($cfg + ['create_db' => true]);
            self::assertTrue($created['ok']);
            self::assertSame('db.exists.created', self::byId($created['checks'], 'db_exists')->hint);
            self::assertSame('utf8mb4', self::byId($created['checks'], 'db_charset')->value);
        } finally {
            DbInspector::connectServer(self::installDbConfig())->exec('DROP DATABASE IF EXISTS `' . $name . '`');
        }
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function versions(): array
    {
        return [
            'mysql 8' => ['8.0.36', 'ok', 'MySQL 8.0.36'],
            'mysql 5.7 log' => ['5.7.44-log', 'ok', 'MySQL 5.7.44'],
            'mysql 5.6' => ['5.6.51', 'error', 'MySQL 5.6.51'],
            'mariadb 10.3' => ['10.3.39-MariaDB-0+deb10u1', 'ok', 'MariaDB 10.3.39'],
            'mariadb 10.2' => ['10.2.44-MariaDB', 'error', 'MariaDB 10.2.44'],
            'mariadb with 5.5.5 prefix' => ['5.5.5-10.11.6-MariaDB', 'ok', 'MariaDB 10.11.6'],
        ];
    }

    #[DataProvider('versions')]
    public function testVersionCheck(string $version, string $status, string $shown): void
    {
        $check = DbInspector::versionCheck($version);
        self::assertSame($status, $check->status);
        self::assertSame($shown, $check->value);
    }
}
