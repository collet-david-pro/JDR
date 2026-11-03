<?php

declare(strict_types=1);

namespace JDR\Tests\Backup;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Logger;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Backup\BackupStorage;
use JDR\Domain\Backup\DbRestore;
use JDR\Domain\Jobs\JobRepository;
use JDR\Domain\Jobs\JobRunner;
use JDR\Domain\Settings\Settings;
use JDR\Tests\Api\ApiTestCase;

/**
 * P10 criterion: a filled database (prefix A) backed up by tiny slices, restored by tiny slices (a new service and
 * connection for every step, as after a cut between two requests) on a blank instance with prefix B: every table
 * has the same fingerprint (php_sessions and background_jobs aside, and the rows the restore writes itself:
 * the maintenance setting and its audit entry).
 */
final class BackupRoundTripTest extends ApiTestCase
{
    private Db $target;

    protected function setUp(): void
    {
        parent::setUp();
        $config = self::dbConfig();
        $config['prefix'] = rtrim($config['prefix'], '_') . 'r_';
        $this->target = new Db($config); // one connection: thousands of them would exhaust the local ports
        $this->dropTarget();
    }

    protected function tearDown(): void
    {
        $this->dropTarget();
    }

    private function dropTarget(): void
    {
        $pdo = $this->target->pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        foreach (self::testTables($this->target) as $table) {
            $pdo->exec('DROP TABLE IF EXISTS `' . $table . '`');
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
    }

    public function testFilledDatabaseRestoredOnAnotherPrefix(): void
    {
        self::assertFalse(str_starts_with($this->target->prefix(), $this->db->prefix()));
        $this->createUser('Root', 'admin');
        $this->fill();
        foreach (['users', 'games', 'maps', 'map_chunks', 'map_notes', 'assets', 'tokens'] as $table) {
            self::assertGreaterThan(0, $this->rows($table), $table);
        }

        // Backup by tiny slices (one batch per step).
        $c = $this->app->container();
        $job = $c->get(JobRepository::class)->create('db_backup', null, 0, ['work' => bin2hex(random_bytes(16)), 'started' => time()]);
        $runner = $c->get(JobRunner::class);
        for ($i = 0; $i < 5000 && !$job->isFinished(); $i++) {
            $job = $runner->step($job, 0.0);
        }
        self::assertSame('done', $job->status, json_encode($job->result));
        self::assertGreaterThan(20, $i);
        $storage = $c->get(BackupStorage::class);
        $dump = $storage->workDir($job->state['work']) . '/' . $job->state['file'];
        $copy = $storage->uploadsDir() . '/roundtrip.sql.gz';
        copy($dump, $copy);

        // Restore on the blank instance B, a fresh service for every step.
        $state = $this->restorer()->start($copy, 1, 'Root', null, time());
        self::assertSame($this->db->prefix(), $state['from']);
        $steps = 0;
        for (; $steps < 20000 && $state['status'] === 'running'; $steps++) {
            $state = $this->restorer()->step($state['id'], $state['token'], microtime(true));
        }
        self::assertSame('done', $state['status'], (string) json_encode(array_diff_key($state, ['tables' => 0, 'token' => 0])));
        self::assertGreaterThan(50, $steps);
        self::assertFalse($state['schema_behind']);

        self::assertSame($this->fingerprint($this->db), $this->fingerprint($this->target));
    }

    /**
     * A new service for every step (state read back from state.json), on the connection of the target.
     */
    private function restorer(): DbRestore
    {
        $db = $this->target;
        $clock = new Clock();

        return new DbRestore($db, new Settings($db, $clock), new AuditLog($db, $clock), $this->app->container()->get(BackupStorage::class),
            new Logger(self::$logDir, $clock, 'error'));
    }

    /**
     * Synthetic rows in every table (foreign keys off): quotes, backslashes, newlines, NUL, emoji, NULL,
     * binary blobs (one of 300 kB), and more than one dump batch (500 rows) in audit_log.
     */
    private function fill(): void
    {
        $pdo = $this->db->pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        try {
            foreach (self::testTables($this->db) as $table) {
                $name = substr($table, strlen($this->db->prefix()));
                if (in_array($name, ['php_sessions', 'background_jobs', 'schema_migrations'], true)) {
                    continue;
                }
                $columns = $this->db->fetchAll(
                    'SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, EXTRA FROM information_schema.COLUMNS '
                    . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
                    [$table],
                );
                $count = $name === 'audit_log' ? 650 : 4;
                for ($i = 0; $i < $count; $i++) {
                    $names = [];
                    $values = [];
                    foreach ($columns as $col) {
                        if (str_contains(strtoupper((string) $col['EXTRA']), 'GENERATED')) {
                            continue;
                        }
                        $names[] = '`' . $col['COLUMN_NAME'] . '`';
                        $values[] = self::value($col, $i);
                    }
                    $this->db->execute('INSERT IGNORE INTO `' . $table . '` (' . implode(', ', $names) . ') VALUES ('
                        . implode(', ', array_fill(0, count($values), '?')) . ')', $values);
                }
            }
        } finally {
            $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    /**
     * @param array<string, mixed> $col
     */
    private static function value(array $col, int $i): mixed
    {
        $type = strtolower((string) $col['DATA_TYPE']);
        if ($col['IS_NULLABLE'] === 'YES' && $i % 4 === 3) {
            return null;
        }
        $max = (int) ($col['CHARACTER_MAXIMUM_LENGTH'] ?? 0);

        return match (true) {
            $type === 'tinyint' => ($i % 2) + 1,
            in_array($type, ['smallint', 'mediumint', 'int', 'bigint'], true) => $i + 1,
            in_array($type, ['decimal', 'float', 'double'], true) => $i + 0.5,
            in_array($type, ['date'], true) => '2026-01-02',
            in_array($type, ['datetime', 'timestamp'], true) => sprintf('2026-01-02 03:04:%02d', $i % 60),
            $type === 'time' => '01:02:03',
            $type === 'year' => 2026,
            $type === 'enum' || $type === 'set' => preg_match("/^(?:enum|set)\\('((?:[^'\\\\]|'')*)'/", (string) $col['COLUMN_TYPE'], $m) === 1 ? $m[1] : '',
            in_array($type, ['tinyblob', 'blob', 'mediumblob', 'longblob'], true) => random_bytes($i === 0 && $type !== 'tinyblob' ? 300000 : 100),
            in_array($type, ['binary', 'varbinary'], true) => random_bytes(max(1, min($max, 32))),
            $type === 'json' || $max >= 200 || $max === 0 && str_contains($type, 'text')
                => "{\n\t\"k\": \"v{$i} é'\\\\ \\\" 😀\",\r\n\"n\": " . $i . '}',
            default => mb_substr("v{$i}'é\\😀" . str_repeat('x', 40), 0, max(1, min($max, 60))),
        };
    }

    /**
     * @return array<string, string> table without prefix => hash of its rows sorted by key
     */
    private function fingerprint(Db $db): array
    {
        $out = [];
        foreach (self::testTables($db) as $table) {
            $name = substr($table, strlen($db->prefix()));
            if (in_array($name, ['php_sessions', 'background_jobs'], true)) {
                continue;
            }
            $where = match ($name) {
                'settings' => " WHERE `key` <> 'maintenance'",
                'audit_log' => " WHERE `action` NOT LIKE 'backup.%'",
                default => '',
            };
            $keys = array_map(static fn (array $r): string => '`' . $r['Column_name'] . '`', $db->fetchAll('SHOW KEYS FROM `' . $table . "` WHERE `Key_name` = 'PRIMARY'"));
            $order = $keys === [] ? '' : ' ORDER BY ' . implode(', ', $keys);
            $hash = hash_init('sha256');
            foreach ($db->fetchAll('SELECT * FROM `' . $table . '`' . $where . $order) as $row) {
                hash_update($hash, json_encode(array_map(static fn ($v) => is_string($v) && preg_match('//u', $v) !== 1 ? bin2hex($v) : $v, $row), JSON_THROW_ON_ERROR) . "\n");
            }
            $out[$name] = hash_final($hash);
        }
        ksort($out);

        return $out;
    }
}
