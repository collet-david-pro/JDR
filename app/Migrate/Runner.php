<?php

declare(strict_types=1);

namespace JDR\Migrate;

use JDR\Core\Db;

defined('JDR_BOOT') || exit;

/**
 * Migration engine (projet.md §8.1-8.2), shared by install.php, update.php and the CLI.
 *
 * - Discovers migrations/NNNN_name.(sql|php), applies them in order.
 * - Records each run in {{prefix}}schema_migrations (status applied|failed, SHA-256 checksum).
 * - Refuses to go on when an applied migration file was modified (ChecksumMismatchException).
 * - SQL files: `{{prefix}}` substituted, statements run one by one; with the
 *   `-- @idempotent-ddl` marker, "already exists" errors are ignored.
 * - PHP files: return an object implementing Migration (or a callable(Db, MigrationLogger)).
 * - A failed migration is recorded as "failed" and can be run again.
 * - Every run is protected by a non-blocking GET_LOCK.
 * - After a success, settings.db_version is updated (when the settings table exists).
 */
final class Runner
{
    /** "Already exists" errors ignored in @idempotent-ddl mode. */
    private const IGNORED_ERRORS = [
        1050, // ER_TABLE_EXISTS_ERROR
        1060, // ER_DUP_FIELDNAME
        1061, // ER_DUP_KEYNAME
        1826, // ER_FK_DUP_NAME (MySQL 8)
    ];
    /** Can't DROP: does not exist (ignored only for DROP statements). */
    private const ERR_CANT_DROP = 1091;
    /** Duplicate FK name on MySQL 5.7 / MariaDB (errno 121 wrapped in 1005 or 1022). */
    private const FK_DUP_ERRORS = [1005, 1022, 1826];
    private const MAX_ERROR_LENGTH = 60000;

    private readonly MigrationLogger $log;
    private readonly Lock $lock;
    /** @var list<MigrationFile>|null */
    private ?array $files = null;

    public function __construct(
        private readonly Db $db,
        private readonly string $dir,
        ?MigrationLogger $log = null
    ) {
        $this->log = $log ?? new CallbackLogger();
        $this->lock = new Lock($db);
    }

    /**
     * DDL of the bookkeeping table. Must stay identical to the one in 0001_initial.sql.
     */
    public static function schemaMigrationsDdl(string $prefix): string
    {
        return 'CREATE TABLE IF NOT EXISTS `' . $prefix . 'schema_migrations` (
  `version` VARCHAR(10) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `error` TEXT NULL,
  `applied_at` DATETIME NOT NULL,
  `duration_ms` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC';
    }

    /**
     * Migrations not yet applied (never run, or failed), in order.
     *
     * @return list<array{version:string,name:string,type:string,status:string,error:?string}>
     * @throws ChecksumMismatchException
     */
    public function pending(): array
    {
        $this->ensureTable();
        $rows = $this->rows();
        $this->verifyChecksums($rows);

        $pending = [];
        foreach ($this->files() as $file) {
            $row = $rows[$file->version] ?? null;
            if ($row !== null && $row['status'] === 'applied') {
                continue;
            }
            $pending[] = $file->toArray() + [
                'status' => $row === null ? 'pending' : (string) $row['status'],
                'error' => $row === null ? null : self::nullableString($row['error']),
            ];
        }

        return $pending;
    }

    /**
     * Applies the next pending migration only (one migration per HTTP request).
     * Returns null when nothing is pending.
     *
     * @return array{version:string,name:string,type:string,status:string,duration_ms:int}|null
     * @throws MigrationLockedException|ChecksumMismatchException|MigrationFailedException
     */
    public function runNext(): ?array
    {
        $this->acquireLock();
        try {
            return $this->runNextLocked();
        } finally {
            $this->lock->release();
        }
    }

    /**
     * Applies every pending migration, stopping at the first failure (exception).
     *
     * @return list<array{version:string,name:string,type:string,status:string,duration_ms:int}>
     * @throws MigrationLockedException|ChecksumMismatchException|MigrationFailedException
     */
    public function runAll(): array
    {
        $this->acquireLock();
        try {
            $done = [];
            while (($result = $this->runNextLocked()) !== null) {
                $done[] = $result;
            }

            return $done;
        } finally {
            $this->lock->release();
        }
    }

    /**
     * Full picture: every known migration (files and recorded rows).
     *
     * @return list<array{version:string,name:string,type:?string,status:string,checksum_ok:?bool,
     *     applied_at:?string,duration_ms:?int,error:?string,file_missing:bool}>
     */
    public function status(): array
    {
        $this->ensureTable();
        $rows = $this->rows();
        $out = [];
        foreach ($this->files() as $file) {
            $row = $rows[$file->version] ?? null;
            unset($rows[$file->version]);
            $out[$file->version] = [
                'version' => $file->version,
                'name' => $file->name,
                'type' => $file->type,
                'status' => $row === null ? 'pending' : (string) $row['status'],
                'checksum_ok' => $row === null ? null : hash_equals((string) $row['checksum'], $file->checksum()),
                'applied_at' => $row === null ? null : (string) $row['applied_at'],
                'duration_ms' => $row === null ? null : (int) $row['duration_ms'],
                'error' => $row === null ? null : self::nullableString($row['error']),
                'file_missing' => false,
            ];
        }
        foreach ($rows as $version => $row) {
            $out[(string) $version] = [
                'version' => (string) $version,
                'name' => (string) $row['name'],
                'type' => null,
                'status' => (string) $row['status'],
                'checksum_ok' => null,
                'applied_at' => (string) $row['applied_at'],
                'duration_ms' => (int) $row['duration_ms'],
                'error' => self::nullableString($row['error']),
                'file_missing' => true,
            ];
        }
        ksort($out, SORT_STRING);

        return array_values($out);
    }

    /**
     * Highest applied version, or null when nothing is applied.
     */
    public function currentVersion(): ?string
    {
        if (!$this->db->tableExists('schema_migrations')) {
            return null;
        }
        $v = $this->db->fetchValue(
            'SELECT MAX(`version`) FROM ' . $this->db->t('schema_migrations') . " WHERE `status` = 'applied'"
        );

        return $v === null ? null : (string) $v;
    }

    /**
     * @return array{version:string,name:string,type:string,status:string,duration_ms:int}|null
     */
    private function runNextLocked(): ?array
    {
        $this->ensureTable();
        $rows = $this->rows();
        $this->verifyChecksums($rows);

        foreach ($this->files() as $file) {
            $row = $rows[$file->version] ?? null;
            if ($row !== null && $row['status'] === 'applied') {
                continue;
            }

            return $this->apply($file, $row !== null);
        }

        return null;
    }

    /**
     * @return array{version:string,name:string,type:string,status:string,duration_ms:int}
     */
    private function apply(MigrationFile $file, bool $retry): array
    {
        $label = $file->version . '_' . $file->name . '.' . $file->type;
        $this->log->info(($retry ? 'Retrying migration ' : 'Applying migration ') . $label, [
            'version' => $file->version,
        ]);
        $start = hrtime(true);

        try {
            if ($file->type === 'sql') {
                $this->applySql($file);
            } else {
                $this->applyPhp($file);
            }
        } catch (\Throwable $e) {
            $ms = self::elapsedMs($start);
            $message = $e->getMessage();
            try {
                $this->record($file, 'failed', mb_strcut($message, 0, self::MAX_ERROR_LENGTH, 'UTF-8'), $ms);
            } catch (\Throwable $recordError) {
                $message .= ' (could not record the failure: ' . $recordError->getMessage() . ')';
            }
            $this->log->info('Migration ' . $label . ' failed: ' . $message, [
                'version' => $file->version,
                'duration_ms' => $ms,
            ]);
            throw new MigrationFailedException($file->version, $file->name, $message, $e);
        }

        $ms = self::elapsedMs($start);
        $this->record($file, 'applied', null, $ms);
        $this->updateDbVersion();
        $this->log->info('Migration ' . $label . ' applied', ['version' => $file->version, 'duration_ms' => $ms]);

        return $file->toArray() + ['status' => 'applied', 'duration_ms' => $ms];
    }

    private function applySql(MigrationFile $file): void
    {
        $sql = str_replace('{{prefix}}', $this->db->prefix(), $file->contents());
        $idempotent = $file->idempotentDdl();
        $pdo = $this->db->pdo();

        foreach (SqlSplitter::split($sql) as $n => $statement) {
            try {
                $pdo->exec($statement);
            } catch (\PDOException $e) {
                if ($idempotent && $this->isIgnorable($e, $statement)) {
                    $this->log->info(sprintf('Statement #%d skipped (already done)', $n + 1), [
                        'version' => $file->version,
                        'error' => self::errorCode($e),
                    ]);
                    continue;
                }
                throw new MigrationException(sprintf(
                    'statement #%d: %s [%s]',
                    $n + 1,
                    $e->getMessage(),
                    self::excerpt($statement)
                ), 0, $e);
            }
        }
    }

    private function applyPhp(MigrationFile $file): void
    {
        $migration = (static function (string $path): mixed {
            return require $path;
        })($file->path);

        if ($migration instanceof Migration) {
            $migration->up($this->db, $this->log);
        } elseif (is_callable($migration)) {
            $migration($this->db, $this->log);
        } else {
            throw new MigrationException('PHP migration must return an instance of ' . Migration::class);
        }
    }

    private function isIgnorable(\PDOException $e, string $statement): bool
    {
        $code = self::errorCode($e);
        if (in_array($code, self::IGNORED_ERRORS, true)) {
            return true;
        }
        if ($code === self::ERR_CANT_DROP && preg_match('/\bDROP\b/i', $statement) === 1) {
            return true;
        }
        // Duplicate FK name: MySQL 5.7 / MariaDB report it as 1005/1022 (errno 121).
        if (
            in_array($code, self::FK_DUP_ERRORS, true)
            && preg_match(
                '/^\s*ALTER\s+TABLE\s+`?([a-z0-9_]+)`?\s+ADD\s+CONSTRAINT\s+`?([a-z0-9_]+)`?\s+FOREIGN\s+KEY/i',
                $statement,
                $m
            ) === 1
        ) {
            $prefix = $this->db->prefix();
            $table = strtolower($m[1]);
            if (str_starts_with($table, $prefix)) {
                return $this->db->foreignKeyExists(substr($table, strlen($prefix)), $m[2]);
            }
        }

        return false;
    }

    private function ensureTable(): void
    {
        if (!$this->db->tableExists('schema_migrations')) {
            $this->db->pdo()->exec(self::schemaMigrationsDdl($this->db->prefix()));
        }
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function rows(): array
    {
        $rows = [];
        foreach ($this->db->fetchAll('SELECT * FROM ' . $this->db->t('schema_migrations')) as $row) {
            $rows[(string) $row['version']] = $row;
        }

        return $rows;
    }

    /**
     * @param array<string, array<string, mixed>> $rows
     */
    private function verifyChecksums(array $rows): void
    {
        foreach ($this->files() as $file) {
            $row = $rows[$file->version] ?? null;
            if ($row === null || $row['status'] !== 'applied') {
                continue; // A failed migration may be fixed before being retried.
            }
            $actual = $file->checksum();
            if (!hash_equals((string) $row['checksum'], $actual)) {
                throw new ChecksumMismatchException($file->version, $file->name, (string) $row['checksum'], $actual);
            }
        }
    }

    private function record(MigrationFile $file, string $status, ?string $error, int $ms): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('schema_migrations')
            . ' (`version`, `name`, `checksum`, `status`, `error`, `applied_at`, `duration_ms`)'
            . ' VALUES (:v, :n, :c, :s, :e, :a, :d)'
            . ' ON DUPLICATE KEY UPDATE `name` = :n2, `checksum` = :c2, `status` = :s2, `error` = :e2,'
            . ' `applied_at` = :a2, `duration_ms` = :d2',
            [
                'v' => $file->version,
                'n' => $file->name, 'n2' => $file->name,
                'c' => $file->checksum(), 'c2' => $file->checksum(),
                's' => $status, 's2' => $status,
                'e' => $error, 'e2' => $error,
                'a' => gmdate('Y-m-d H:i:s'), 'a2' => gmdate('Y-m-d H:i:s'),
                'd' => $ms, 'd2' => $ms,
            ]
        );
    }

    private function updateDbVersion(): void
    {
        if (!$this->db->tableExists('settings')) {
            return;
        }
        $version = $this->currentVersion();
        if ($version === null) {
            return;
        }
        $json = json_encode($version, JSON_THROW_ON_ERROR);
        $now = gmdate('Y-m-d H:i:s');
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('settings') . ' (`key`, `value`, `updated_at`)'
            . " VALUES ('db_version', :v, :u) ON DUPLICATE KEY UPDATE `value` = :v2, `updated_at` = :u2",
            ['v' => $json, 'u' => $now, 'v2' => $json, 'u2' => $now]
        );
    }

    /**
     * @return list<MigrationFile>
     */
    private function files(): array
    {
        return $this->files ??= MigrationFile::discover($this->dir);
    }

    private function acquireLock(): void
    {
        if (!$this->lock->acquire()) {
            throw new MigrationLockedException('Another migration run is in progress (lock "' . $this->lock->name()
                . '" is held). Try again in a moment.');
        }
    }

    private static function errorCode(\PDOException $e): int
    {
        $info = $e->errorInfo ?? null;

        return is_array($info) ? (int) ($info[1] ?? 0) : 0;
    }

    private static function elapsedMs(int|float $start): int
    {
        return (int) round((hrtime(true) - $start) / 1e6);
    }

    private static function excerpt(string $statement): string
    {
        $one = preg_replace('/\s+/', ' ', $statement) ?? $statement;

        return mb_strlen($one) > 120 ? mb_substr($one, 0, 117) . '...' : $one;
    }

    private static function nullableString(mixed $v): ?string
    {
        return $v === null ? null : (string) $v;
    }
}
