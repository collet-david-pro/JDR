<?php

declare(strict_types=1);

namespace JDR\Tests\Migrate;

use JDR\Core\Db;
use JDR\Tests\Support\DbTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

require_once __DIR__ . '/../Support/DbTestCase.php';

final class DbTest extends DbTestCase
{
    private Db $db;

    protected function setUp(): void
    {
        $this->db = self::newDb();
        self::dropTestTables($this->db);
        $this->db->pdo()->exec('CREATE TABLE ' . $this->db->t('dbtest') . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(50) NOT NULL,
            n INT NULL,
            flag TINYINT(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            KEY idx_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $this->db->pdo()->exec('CREATE TABLE ' . $this->db->t('dbtest_child') . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            parent_id BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (id),
            KEY idx_parent (parent_id),
            CONSTRAINT `fk_' . $this->db->prefix() . 'dbtest_child_parent` FOREIGN KEY (parent_id)
              REFERENCES ' . $this->db->t('dbtest') . ' (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }

    protected function tearDown(): void
    {
        self::dropTestTables($this->db);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function invalidPrefixes(): array
    {
        return [
            'empty' => [''],
            'uppercase' => ['Jdr_'],
            'leading digit' => ['1jdr_'],
            'dash' => ['jdr-'],
            'backtick' => ['jd`r'],
            'too long (17)' => ['abcdefghijklmnopq'],
        ];
    }

    #[DataProvider('invalidPrefixes')]
    public function testInvalidPrefixIsRejected(string $prefix): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Db(['prefix' => $prefix] + self::dbConfig());
    }

    public function testValidPrefixesAreAccepted(): void
    {
        self::assertSame('a', (new Db(['prefix' => 'a'] + self::dbConfig()))->prefix());
        self::assertSame('abcdefghijklmnop', (new Db(['prefix' => 'abcdefghijklmnop'] + self::dbConfig()))->prefix());
    }

    public function testTableNameIsPrefixedAndQuoted(): void
    {
        self::assertSame('`' . $this->db->prefix() . 'users`', $this->db->t('users'));
        self::assertSame('`' . $this->db->prefix() . 'map_floors`', $this->db->t('map_floors'));
    }

    /**
     * @return array<string, array{string}>
     */
    public static function invalidTables(): array
    {
        return [
            'empty' => [''],
            'uppercase' => ['Users'],
            'backtick' => ['us`ers'],
            'space' => ['users x'],
            'dot' => ['db.users'],
            'leading digit' => ['1users'],
        ];
    }

    #[DataProvider('invalidTables')]
    public function testInvalidTableNameIsRejected(string $table): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->db->t($table);
    }

    public function testConnectionIsLazy(): void
    {
        $db = new Db(['host' => '127.0.0.1', 'port' => 1] + self::dbConfig());
        self::assertSame(self::dbConfig()['prefix'], $db->prefix());
        $this->expectException(\PDOException::class);
        $db->pdo();
    }

    public function testPdoIsReused(): void
    {
        self::assertSame($this->db->pdo(), $this->db->pdo());
    }

    public function testSessionIsUtcAndStrict(): void
    {
        self::assertSame('+00:00', $this->db->fetchValue('SELECT @@session.time_zone'));
        $modes = explode(',', (string) $this->db->fetchValue('SELECT @@session.sql_mode'));
        sort($modes);
        self::assertSame([
            'ERROR_FOR_DIVISION_BY_ZERO',
            'NO_ENGINE_SUBSTITUTION',
            'NO_ZERO_DATE',
            'NO_ZERO_IN_DATE',
            'STRICT_ALL_TABLES',
        ], $modes);
        self::assertSame('utf8mb4', $this->db->fetchValue('SELECT @@character_set_connection'));
    }

    public function testStrictModeRejectsInvalidData(): void
    {
        $this->expectException(\PDOException::class);
        $this->db->execute('INSERT INTO ' . $this->db->t('dbtest') . ' (name, n) VALUES (?, ?)', ['x', 'not a number']);
    }

    public function testQueryHelpers(): void
    {
        $t = $this->db->t('dbtest');
        self::assertSame(1, $this->db->execute("INSERT INTO $t (name, n, flag) VALUES (?, ?, ?)", ['alice', 42, true]));
        self::assertSame('1', $this->db->lastInsertId());
        self::assertSame(1, $this->db->execute("INSERT INTO $t (name, n, flag) VALUES (:name, :n, :flag)", [
            'name' => 'bob',
            'n' => null,
            'flag' => false,
        ]));
        self::assertSame('2', $this->db->lastInsertId());
        $this->db->execute("INSERT INTO $t (name) VALUES (:name)", [':name' => 'carol']);

        $row = $this->db->fetchOne("SELECT * FROM $t WHERE name = ?", ['alice']);
        self::assertSame(['id' => 1, 'name' => 'alice', 'n' => 42, 'flag' => 1], $row);
        self::assertNull($this->db->fetchOne("SELECT * FROM $t WHERE name = ?", ['nobody']));

        $bob = $this->db->fetchOne("SELECT n, flag FROM $t WHERE id = ?", [2]);
        self::assertSame(['n' => null, 'flag' => 0], $bob);

        $all = $this->db->fetchAll("SELECT name FROM $t ORDER BY id LIMIT ?", [2]);
        self::assertSame([['name' => 'alice'], ['name' => 'bob']], $all);
        self::assertSame([], $this->db->fetchAll("SELECT name FROM $t WHERE id > ?", [100]));

        self::assertSame(3, $this->db->fetchValue("SELECT COUNT(*) FROM $t"));
        self::assertNull($this->db->fetchValue("SELECT name FROM $t WHERE id = ?", [100]));
        self::assertSame(2, $this->db->execute("UPDATE $t SET n = 7 WHERE id >= ?", [2]));
        self::assertInstanceOf(\PDOStatement::class, $this->db->query("SELECT 1"));

        $utf8 = 'Épée de glace 🐉';
        $this->db->execute("UPDATE $t SET name = ? WHERE id = 1", [$utf8]);
        self::assertSame($utf8, $this->db->fetchValue("SELECT name FROM $t WHERE id = 1"));
    }

    public function testTransactionCommitsAndReturnsValue(): void
    {
        $t = $this->db->t('dbtest');
        $result = $this->db->transaction(function (Db $db) use ($t): string {
            $db->execute("INSERT INTO $t (name) VALUES ('tx')");

            return 'done';
        });
        self::assertSame('done', $result);
        self::assertFalse($this->db->pdo()->inTransaction());
        self::assertSame(1, self::newDb()->fetchValue("SELECT COUNT(*) FROM $t"));
    }

    public function testTransactionRollsBackOnException(): void
    {
        $t = $this->db->t('dbtest');
        try {
            $this->db->transaction(function (Db $db) use ($t): void {
                $db->execute("INSERT INTO $t (name) VALUES ('tx')");
                throw new \DomainException('boom');
            });
            self::fail('Exception expected');
        } catch (\DomainException $e) {
            self::assertSame('boom', $e->getMessage());
        }
        self::assertFalse($this->db->pdo()->inTransaction());
        self::assertSame(0, $this->db->fetchValue("SELECT COUNT(*) FROM $t"));
    }

    public function testNestedTransactionRunsInsideOuterOne(): void
    {
        $t = $this->db->t('dbtest');
        try {
            $this->db->transaction(function (Db $db) use ($t): void {
                $db->execute("INSERT INTO $t (name) VALUES ('outer')");
                $inner = $db->transaction(function (Db $db) use ($t): int {
                    $db->execute("INSERT INTO $t (name) VALUES ('inner')");

                    return 5;
                });
                self::assertSame(5, $inner);
                self::assertTrue($db->pdo()->inTransaction());
                throw new \DomainException('rollback all');
            });
        } catch (\DomainException) {
        }
        self::assertSame(0, $this->db->fetchValue("SELECT COUNT(*) FROM $t"));

        // The instance is usable again for a normal transaction afterwards.
        $this->db->transaction(fn (Db $db) => $db->execute("INSERT INTO $t (name) VALUES ('after')"));
        self::assertSame(1, $this->db->fetchValue("SELECT COUNT(*) FROM $t"));
    }

    public function testTransactionRetriesTwiceOnDeadlock(): void
    {
        $t = $this->db->t('dbtest');
        $calls = 0;
        $result = $this->db->transaction(function (Db $db) use (&$calls, $t): string {
            $calls++;
            $db->execute("INSERT INTO $t (name) VALUES (?)", ['attempt' . $calls]);
            if ($calls <= 2) {
                throw self::deadlock();
            }

            return 'ok';
        });
        self::assertSame('ok', $result);
        self::assertSame(3, $calls);
        // Failed attempts were rolled back.
        self::assertSame([['name' => 'attempt3']], $this->db->fetchAll("SELECT name FROM $t"));
    }

    public function testTransactionGivesUpAfterTwoRetries(): void
    {
        $calls = 0;
        try {
            $this->db->transaction(function () use (&$calls): void {
                $calls++;
                throw self::deadlock();
            });
            self::fail('Exception expected');
        } catch (\PDOException $e) {
            self::assertSame(1213, $e->errorInfo[1]);
        }
        self::assertSame(3, $calls);
        self::assertFalse($this->db->pdo()->inTransaction());
    }

    public function testTransactionDoesNotRetryOtherErrors(): void
    {
        $calls = 0;
        try {
            $this->db->transaction(function (Db $db) use (&$calls): void {
                $calls++;
                $db->query('SELECT * FROM ' . $db->t('does_not_exist'));
            });
            self::fail('Exception expected');
        } catch (\PDOException) {
        }
        self::assertSame(1, $calls);
    }

    public function testSchemaIntrospection(): void
    {
        $db = $this->db;
        self::assertTrue($db->tableExists('dbtest'));
        self::assertFalse($db->tableExists('nope'));
        self::assertTrue($db->columnExists('dbtest', 'name'));
        self::assertFalse($db->columnExists('dbtest', 'nope'));
        self::assertFalse($db->columnExists('nope', 'name'));
        self::assertTrue($db->indexExists('dbtest', 'idx_name'));
        self::assertTrue($db->indexExists('dbtest', 'PRIMARY'));
        self::assertFalse($db->indexExists('dbtest', 'idx_nope'));
        self::assertTrue($db->foreignKeyExists('dbtest_child', 'fk_{{prefix}}dbtest_child_parent'));
        self::assertTrue($db->foreignKeyExists('dbtest_child', 'fk_' . $db->prefix() . 'dbtest_child_parent'));
        self::assertFalse($db->foreignKeyExists('dbtest_child', 'fk_{{prefix}}nope'));
        self::assertFalse($db->foreignKeyExists('dbtest', 'fk_{{prefix}}dbtest_child_parent'));
    }

    public function testServerVersion(): void
    {
        self::assertMatchesRegularExpression('/^\d+\.\d+/', $this->db->serverVersion());
    }

    private static function deadlock(): \PDOException
    {
        $e = new \PDOException('SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock');
        $e->errorInfo = ['40001', 1213, 'Deadlock found when trying to get lock'];

        return $e;
    }
}
