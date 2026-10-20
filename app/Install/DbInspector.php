<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Step 2: database checks (projet.md 19). Writes nothing except, when allowed, the database itself
 * and two temporary probe tables (privilege test), dropped right away.
 */
final class DbInspector
{
    public const MIN_MYSQL = '5.7.0';
    public const MIN_MARIADB = '10.3.0';
    private const MAX_CLOCK_SKEW = 120;

    /**
     * @param array{host:string,port:int,name:string,user:string,pass:string,prefix:string,create_db?:bool} $cfg
     * @return array{ok:bool, checks:list<Check>, existing:list<string>, resumable:bool}
     */
    public function inspect(array $cfg): array
    {
        $checks = [];
        $existing = [];
        try {
            $pdo = self::connectServer($cfg);
        } catch (\PDOException $e) {
            $checks[] = new Check('db_connect', Check::ERROR, 'db.connect', '', self::connectHint($e), [
                'message' => self::sanitize($e->getMessage(), $cfg['pass']),
            ]);

            return ['ok' => false, 'checks' => $checks, 'existing' => [], 'resumable' => false];
        }
        $checks[] = new Check('db_connect', Check::OK, 'db.connect', $cfg['user'] . '@' . $cfg['host'] . ':' . $cfg['port']);

        $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
        $checks[] = self::versionCheck($version);

        $checks[] = $this->database($pdo, $cfg);
        if (Check::worst($checks) === Check::ERROR) {
            return ['ok' => false, 'checks' => $checks, 'existing' => [], 'resumable' => false];
        }
        $pdo->exec('USE ' . self::quoteIdent($cfg['name']));

        $checks[] = self::innodb($pdo);
        $checks[] = self::utf8mb4($pdo, $cfg['name']);
        $checks = array_merge($checks, self::privileges($pdo, $cfg['prefix']));
        $checks[] = self::clock($pdo);

        $existing = self::existingTables($pdo, $cfg['prefix']);
        $resumable = in_array($cfg['prefix'] . 'schema_migrations', $existing, true);

        return [
            'ok' => Check::worst($checks) !== Check::ERROR,
            'checks' => $checks,
            'existing' => $existing,
            'resumable' => $resumable,
        ];
    }

    /**
     * Connection without selecting a database, with the session settings of projet.md 6.2.
     *
     * @param array{host:string,port:int,user:string,pass:string} $cfg
     */
    public static function connectServer(array $cfg): \PDO
    {
        $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $cfg['host'], $cfg['port']);
        $pdo = new \PDO($dsn, $cfg['user'], $cfg['pass'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_STRINGIFY_FETCHES => false,
            \PDO::ATTR_TIMEOUT => 5,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
        $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,"
            . "ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");

        return $pdo;
    }

    /**
     * Drops every table of the prefix (choice "overwrite", executed at step 5 only).
     *
     * @return list<string> dropped tables
     */
    public static function dropPrefixed(\PDO $pdo, string $prefix): array
    {
        $tables = self::existingTables($pdo, $prefix);
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        try {
            foreach ($tables as $table) {
                $pdo->exec('DROP TABLE IF EXISTS ' . self::quoteIdent($table));
            }
        } finally {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        }

        return $tables;
    }

    /**
     * Tables of the current database whose name starts with $prefix.
     *
     * @return list<string>
     */
    public static function existingTables(\PDO $pdo, string $prefix): array
    {
        $stmt = $pdo->prepare('SELECT TABLE_NAME FROM information_schema.TABLES '
            . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ? ORDER BY TABLE_NAME');
        $stmt->execute([addcslashes($prefix, '\\_%') . '%']);

        return array_map('strval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
    }

    public static function versionCheck(string $version): Check
    {
        $maria = stripos($version, 'mariadb') !== false;
        $number = preg_match($maria ? '/(\d+\.\d+\.\d+)-MariaDB/i' : '/^(\d+\.\d+\.\d+)/', $version, $m) === 1
            ? $m[1]
            : (preg_match('/(\d+\.\d+\.\d+)/', $version, $m2) === 1 ? $m2[1] : '0.0.0');
        $min = $maria ? self::MIN_MARIADB : self::MIN_MYSQL;
        $ok = version_compare($number, $min, '>=');

        return Check::when($ok, 'db_version', 'db.version', ($maria ? 'MariaDB ' : 'MySQL ') . $number, 'db.version.old');
    }

    /**
     * @param array{name:string,create_db?:bool} $cfg
     */
    private function database(\PDO $pdo, array $cfg): Check
    {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
        $stmt->execute([$cfg['name']]);
        if ((int) $stmt->fetchColumn() > 0) {
            return new Check('db_exists', Check::OK, 'db.exists', $cfg['name']);
        }
        if (!($cfg['create_db'] ?? false)) {
            return new Check('db_exists', Check::ERROR, 'db.exists', $cfg['name'], 'db.exists.missing');
        }
        try {
            $pdo->exec('CREATE DATABASE IF NOT EXISTS ' . self::quoteIdent($cfg['name'])
                . ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        } catch (\PDOException $e) {
            return new Check('db_exists', Check::ERROR, 'db.exists', $cfg['name'], 'db.exists.create_failed', [
                'message' => self::sanitize($e->getMessage(), ''),
            ]);
        }

        return new Check('db_exists', Check::OK, 'db.exists', $cfg['name'], 'db.exists.created');
    }

    private static function innodb(\PDO $pdo): Check
    {
        $support = strtoupper((string) $pdo->query("SELECT SUPPORT FROM information_schema.ENGINES WHERE ENGINE = 'InnoDB'")
            ->fetchColumn());
        $ok = $support === 'YES' || $support === 'DEFAULT';

        return Check::when($ok, 'db_innodb', 'db.innodb', $ok ? 'InnoDB' : '✗', 'db.innodb.no');
    }

    private static function utf8mb4(\PDO $pdo, string $name): Check
    {
        $has = $pdo->query("SHOW CHARACTER SET LIKE 'utf8mb4'")->fetch() !== false;
        if (!$has) {
            return new Check('db_charset', Check::ERROR, 'db.charset', '✗', 'db.charset.no');
        }
        $stmt = $pdo->prepare('SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
        $stmt->execute([$name]);
        $default = (string) $stmt->fetchColumn();

        // Every table declares utf8mb4 explicitly: another default charset is only a warning.
        return $default === 'utf8mb4'
            ? new Check('db_charset', Check::OK, 'db.charset', 'utf8mb4')
            : new Check('db_charset', Check::WARN, 'db.charset', $default, 'db.charset.default');
    }

    /**
     * CREATE / REFERENCES / ALTER / INDEX / DML / DROP on two temporary tables.
     *
     * @return list<Check>
     */
    private static function privileges(\PDO $pdo, string $prefix): array
    {
        $suffix = bin2hex(random_bytes(3));
        $parent = $prefix . 'zz_probe_' . $suffix . '_p';
        $child = $prefix . 'zz_probe_' . $suffix . '_c';
        $opts = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        $steps = [
            'CREATE' => 'CREATE TABLE ' . self::quoteIdent($parent)
                . ' (id INT UNSIGNED NOT NULL AUTO_INCREMENT, v VARCHAR(10) NULL, PRIMARY KEY (id))' . $opts,
            'REFERENCES' => 'CREATE TABLE ' . self::quoteIdent($child)
                . ' (id INT UNSIGNED NOT NULL AUTO_INCREMENT, p_id INT UNSIGNED NOT NULL, PRIMARY KEY (id),'
                . ' CONSTRAINT ' . self::quoteIdent('fk_' . $prefix . 'zzprobe_' . $suffix)
                . ' FOREIGN KEY (p_id) REFERENCES ' . self::quoteIdent($parent) . ' (id) ON DELETE CASCADE)' . $opts,
            'ALTER' => 'ALTER TABLE ' . self::quoteIdent($parent) . ' ADD COLUMN w INT NULL',
            'INDEX' => 'CREATE INDEX idx_v ON ' . self::quoteIdent($parent) . ' (v)',
            'SELECT, INSERT, UPDATE, DELETE' => 'INSERT INTO ' . self::quoteIdent($parent) . " (v) VALUES ('a');"
                . 'UPDATE ' . self::quoteIdent($parent) . " SET v = 'b';"
                . 'SELECT COUNT(*) FROM ' . self::quoteIdent($parent) . ';'
                . 'DELETE FROM ' . self::quoteIdent($parent),
        ];
        $missing = [];
        try {
            foreach ($steps as $privilege => $sql) {
                try {
                    foreach (explode(';', $sql) as $statement) {
                        $pdo->query($statement)->closeCursor();
                    }
                } catch (\PDOException) {
                    $missing[] = $privilege;
                    if ($privilege === 'CREATE') {
                        break; // nothing else can be tested
                    }
                }
            }
        } finally {
            foreach ([$child, $parent] as $table) {
                try {
                    $pdo->exec('DROP TABLE IF EXISTS ' . self::quoteIdent($table));
                } catch (\PDOException) {
                    if (!in_array('DROP', $missing, true)) {
                        $missing[] = 'DROP';
                    }
                }
            }
        }

        return [$missing === []
            ? new Check('db_privileges', Check::OK, 'db.privileges', 'CREATE, ALTER, INDEX, REFERENCES, DROP')
            : new Check('db_privileges', Check::ERROR, 'db.privileges', implode(', ', $missing), 'db.privileges.missing', [
                'list' => implode(', ', $missing),
            ])];
    }

    private static function clock(\PDO $pdo): Check
    {
        $dbTime = (int) $pdo->query('SELECT UNIX_TIMESTAMP()')->fetchColumn();
        $skew = abs($dbTime - time());

        return new Check(
            'db_clock',
            $skew <= self::MAX_CLOCK_SKEW ? Check::OK : Check::WARN,
            'db.clock',
            $skew . ' s',
            $skew <= self::MAX_CLOCK_SKEW ? null : 'db.clock.skew',
        );
    }

    private static function connectHint(\PDOException $e): string
    {
        $code = is_array($e->errorInfo ?? null) ? (int) ($e->errorInfo[1] ?? 0) : 0;
        $code = $code !== 0 ? $code : (int) $e->getCode();

        return match (true) {
            $code === 1045 => 'db.connect.denied',
            $code === 2002, $code === 2003, $code === 2005, $code === 2006 => 'db.connect.host',
            default => 'db.connect.failed',
        };
    }

    /**
     * Never shows the password in a message, even if a driver echoes it.
     */
    private static function sanitize(string $message, string $password): string
    {
        $message = $password !== '' ? str_replace($password, '***', $message) : $message;

        return mb_substr(preg_replace('/^SQLSTATE\[[^\]]*\]\s*(\[\d+\]\s*)?/', '', $message) ?? $message, 0, 300);
    }

    public static function quoteIdent(string $name): string
    {
        return '`' . str_replace('`', '``', $name) . '`';
    }
}
