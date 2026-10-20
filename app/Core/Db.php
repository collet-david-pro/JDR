<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Thin PDO wrapper (projet.md §6.2).
 *
 * - Lazy connection (opened on first use), one connection per instance.
 * - Imposes UTC time zone and a strict, portable sql_mode on every connection.
 * - Table prefix applied through t('users') => `jdr_users`.
 * - transaction() retries twice on deadlock (SQLSTATE 40001 / error 1213).
 */
final class Db
{
    private const PREFIX_PATTERN = '/^[a-z][a-z0-9_]{0,15}$/';
    private const TABLE_PATTERN = '/^[a-z][a-z0-9_]*$/';
    private const DEADLOCK_RETRIES = 2;

    private ?\PDO $pdo = null;
    private string $host;
    private int $port;
    private string $name;
    private string $user;
    private string $pass;
    private string $prefix;
    private int $txDepth = 0;

    /**
     * @param array{host?:string,port?:int|string,name?:string,user?:string,pass?:string,prefix?:string} $cfg
     */
    public function __construct(array $cfg)
    {
        $this->host = (string) ($cfg['host'] ?? '127.0.0.1');
        $this->port = (int) ($cfg['port'] ?? 3306);
        $this->name = (string) ($cfg['name'] ?? '');
        $this->user = (string) ($cfg['user'] ?? '');
        $this->pass = (string) ($cfg['pass'] ?? '');
        $this->prefix = (string) ($cfg['prefix'] ?? 'jdr_');

        if (preg_match(self::PREFIX_PATTERN, $this->prefix) !== 1) {
            throw new \InvalidArgumentException('Invalid table prefix (expected ^[a-z][a-z0-9_]{0,15}$).');
        }
        if ($this->name === '') {
            throw new \InvalidArgumentException('Database name is required.');
        }
    }

    public function pdo(): \PDO
    {
        if ($this->pdo === null) {
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                $this->host,
                $this->port,
                $this->name
            );
            $pdo = new \PDO($dsn, $this->user, $this->pass, [
                \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                \PDO::ATTR_EMULATE_PREPARES   => false,
                \PDO::ATTR_STRINGIFY_FETCHES  => false,
            ]);
            $pdo->exec("SET time_zone = '+00:00'");
            $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,"
                . "ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
            $this->pdo = $pdo;
        }

        return $this->pdo;
    }

    public function prefix(): string
    {
        return $this->prefix;
    }

    /**
     * Prefixed and quoted table name: t('users') => `jdr_users`.
     */
    public function t(string $table): string
    {
        return '`' . $this->rawTable($table) . '`';
    }

    /**
     * @param array<int|string, mixed> $params
     */
    public function query(string $sql, array $params = []): \PDOStatement
    {
        $pdo = $this->pdo();
        if ($params === []) {
            $stmt = $pdo->query($sql);
            if ($stmt === false) {
                throw new \RuntimeException('Query failed.');
            }

            return $stmt;
        }

        $stmt = $pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $name = is_int($key) ? $key + 1 : (str_starts_with($key, ':') ? $key : ':' . $key);
            if (is_bool($value)) {
                $value = (int) $value;
            }
            $stmt->bindValue($name, $value, self::paramType($value));
        }
        $stmt->execute();

        return $stmt;
    }

    /**
     * @param array<int|string, mixed> $params
     * @return array<string, mixed>|null
     */
    public function fetchOne(string $sql, array $params = []): ?array
    {
        $row = $this->query($sql, $params)->fetch(\PDO::FETCH_ASSOC);

        return $row === false ? null : $row;
    }

    /**
     * @param array<int|string, mixed> $params
     * @return list<array<string, mixed>>
     */
    public function fetchAll(string $sql, array $params = []): array
    {
        return $this->query($sql, $params)->fetchAll(\PDO::FETCH_ASSOC);
    }

    /**
     * First column of the first row, or null when there is no row.
     *
     * @param array<int|string, mixed> $params
     */
    public function fetchValue(string $sql, array $params = []): mixed
    {
        $value = $this->query($sql, $params)->fetchColumn();

        return $value === false ? null : $value;
    }

    /**
     * Runs a write statement and returns the affected row count.
     *
     * @param array<int|string, mixed> $params
     */
    public function execute(string $sql, array $params = []): int
    {
        return $this->query($sql, $params)->rowCount();
    }

    public function lastInsertId(): string
    {
        return (string) $this->pdo()->lastInsertId();
    }

    /**
     * Runs $fn($this) inside a transaction and returns its result.
     * Retries up to twice on deadlock / serialization failure.
     * A nested call runs $fn directly inside the outer transaction.
     */
    public function transaction(callable $fn): mixed
    {
        $pdo = $this->pdo();
        if ($this->txDepth > 0 || $pdo->inTransaction()) {
            return $fn($this);
        }

        $attempt = 0;
        while (true) {
            $pdo->beginTransaction();
            $this->txDepth++;
            try {
                $result = $fn($this);
                $this->txDepth--;
                $pdo->commit();

                return $result;
            } catch (\Throwable $e) {
                $this->txDepth = 0;
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                if ($attempt < self::DEADLOCK_RETRIES && self::isDeadlock($e)) {
                    $attempt++;
                    usleep(random_int(10_000, 50_000) * $attempt);
                    continue;
                }
                throw $e;
            }
        }
    }

    public function tableExists(string $table): bool
    {
        return (int) $this->fetchValue(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
            [$this->rawTable($table)]
        ) > 0;
    }

    public function columnExists(string $table, string $column): bool
    {
        return (int) $this->fetchValue(
            'SELECT COUNT(*) FROM information_schema.COLUMNS '
            . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [$this->rawTable($table), $column]
        ) > 0;
    }

    /**
     * $index may contain the {{prefix}} placeholder.
     */
    public function indexExists(string $table, string $index): bool
    {
        return (int) $this->fetchValue(
            'SELECT COUNT(*) FROM information_schema.STATISTICS '
            . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
            [$this->rawTable($table), $this->expandPrefix($index)]
        ) > 0;
    }

    /**
     * $fk is the full constraint name; it may contain the {{prefix}} placeholder
     * (e.g. 'fk_{{prefix}}maps_game').
     */
    public function foreignKeyExists(string $table, string $fk): bool
    {
        return (int) $this->fetchValue(
            'SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS '
            . "WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? "
            . "AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
            [$this->rawTable($table), $this->expandPrefix($fk)]
        ) > 0;
    }

    public function serverVersion(): string
    {
        return (string) $this->fetchValue('SELECT VERSION()');
    }

    private function rawTable(string $table): string
    {
        if (preg_match(self::TABLE_PATTERN, $table) !== 1) {
            throw new \InvalidArgumentException('Invalid table name: ' . $table);
        }

        return $this->prefix . $table;
    }

    private function expandPrefix(string $name): string
    {
        return str_replace('{{prefix}}', $this->prefix, $name);
    }

    private static function paramType(mixed $value): int
    {
        return match (true) {
            $value === null => \PDO::PARAM_NULL,
            is_int($value) => \PDO::PARAM_INT,
            default => \PDO::PARAM_STR,
        };
    }

    private static function isDeadlock(\Throwable $e): bool
    {
        if (!$e instanceof \PDOException) {
            return false;
        }
        $info = $e->errorInfo ?? null;
        if (is_array($info)) {
            if (($info[0] ?? null) === '40001' || (int) ($info[1] ?? 0) === 1213) {
                return true;
            }
        }

        return (string) $e->getCode() === '40001';
    }
}
