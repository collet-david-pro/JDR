<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * SQL backup and restore of every table of the prefix, by time slices (resumable between requests).
 *
 * File: storage/backups/jdr-<YYYYmmdd-HHiiss>-v<version>.sql.gz, plain SQL (readable by the mysql client),
 * one statement per line: header SETs, then per table DROP TABLE IF EXISTS + SHOW CREATE TABLE + INSERT batches.
 * Each slice appends a gzip member (concatenated members are a valid gzip stream); the cursor remembers
 * the file size after the last finished slice, so a slice cut short is truncated away before resuming.
 * The sessions table (php_sessions) is left out: it is live data, and the current admin session lives there.
 *
 * Cursor (stored in state.json, format stable): {file, tables: [names], table: index, phase: schema|rows,
 * key: last primary key value|null, offset: rows done in the table, bytes, rows, done}.
 * Restore cursor: {file, tables, pos: uncompressed offset, dropped: bool, done}.
 */
final class SqlBackup
{
    public const KEEP = 3;
    private const BATCH_ROWS = 500;
    private const BATCH_BYTES = 1048576;
    private const SKIPPED = ['php_sessions'];

    public function __construct(private Db $db, private string $dir)
    {
    }

    public function path(string $file): string
    {
        return $this->dir . '/' . basename($file);
    }

    /**
     * @return array<string, mixed> cursor
     */
    public function start(string $version, int $now): array
    {
        $safe = preg_replace('/[^0-9A-Za-z.-]/', '_', $version) ?? 'x';
        $file = 'jdr-' . gmdate('Ymd-His', $now) . '-v' . $safe . '.sql.gz';
        $header = '-- JDR database backup, version ' . $version . ', ' . gmdate('Y-m-d H:i:s', $now) . ' UTC, prefix '
            . $this->db->prefix() . "\n" . "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n"
            . "SET time_zone='+00:00';\n";
        @unlink($this->path($file)); // a start replayed within the same second begins a fresh file
        $this->append($this->path($file), $header);

        return ['file' => $file, 'tables' => $this->tables(), 'table' => 0, 'phase' => 'schema', 'key' => null,
            'offset' => 0, 'bytes' => (int) filesize($this->path($file)), 'rows' => 0, 'done' => false];
    }

    /**
     * Prefixed tables of the database (sessions table excluded).
     *
     * @return list<string>
     */
    public function tables(): array
    {
        $prefix = $this->db->prefix();
        $out = [];
        foreach ($this->db->pdo()->query('SHOW TABLES')->fetchAll(\PDO::FETCH_COLUMN) as $name) {
            $name = (string) $name;
            if (str_starts_with($name, $prefix) && !in_array(substr($name, strlen($prefix)), self::SKIPPED, true)) {
                $out[] = $name;
            }
        }
        sort($out, SORT_STRING);

        return $out;
    }

    /**
     * Dumps until $deadline (microtime) or the end.
     *
     * @param array<string, mixed> $c
     * @return array<string, mixed>
     */
    public function run(array $c, float $deadline): array
    {
        $path = $this->path((string) $c['file']);
        clearstatcache(true, $path);
        if (is_file($path) && (int) filesize($path) > (int) $c['bytes']) {
            $h = fopen($path, 'r+b');
            if ($h !== false) {
                ftruncate($h, (int) $c['bytes']); // drops a slice that was cut short
                fclose($h);
            }
        }
        $out = '';
        $tables = $c['tables'];
        while (!$c['done']) {
            if ($c['table'] >= count($tables)) {
                $out .= "SET FOREIGN_KEY_CHECKS=1;\n-- end\n";
                $c['done'] = true;
                break;
            }
            $table = (string) $tables[$c['table']];
            if ($c['phase'] === 'schema') {
                $create = $this->db->fetchOne('SHOW CREATE TABLE `' . $table . '`');
                $ddl = (string) ($create['Create Table'] ?? array_values($create ?? [])[1] ?? '');
                $out .= 'DROP TABLE IF EXISTS `' . $table . "`;\n" . str_replace(["\r\n", "\n", "\r"], ' ', $ddl) . ";\n";
                $c['phase'] = 'rows';
                $c['key'] = null;
                $c['offset'] = 0;
            }
            [$sql, $count, $last] = $this->batch($table, $c['key'], (int) $c['offset']);
            if ($count === 0) {
                $c['table']++;
                $c['phase'] = 'schema';
            } else {
                $out .= $sql;
                $c['key'] = $last;
                $c['offset'] += $count;
                $c['rows'] += $count;
            }
            if (strlen($out) > self::BATCH_BYTES) {
                $this->append($path, $out);
                $out = '';
            }
            if (microtime(true) >= $deadline) {
                break;
            }
        }
        if ($out !== '') {
            $this->append($path, $out);
        }
        clearstatcache(true, $path);
        $c['bytes'] = (int) filesize($path);

        return $c;
    }

    /**
     * Keeps the KEEP most recent backups (plus $protect).
     */
    public function prune(?string $protect = null): void
    {
        $files = glob($this->dir . '/jdr-*.sql.gz') ?: [];
        rsort($files, SORT_STRING); // names start with the timestamp
        foreach (array_slice($files, self::KEEP) as $file) {
            if ($protect === null || basename($file) !== basename($protect)) {
                @unlink($file);
            }
        }
    }

    /**
     * @param array<string, mixed> $backup cursor of the finished backup
     * @return array<string, mixed>
     */
    public function restoreStart(array $backup): array
    {
        return ['file' => $backup['file'], 'tables' => $backup['tables'], 'pos' => 0, 'dropped' => false, 'done' => false];
    }

    /**
     * Replays the dump until $deadline. Tables created after the backup (same prefix) are dropped first.
     *
     * @param array<string, mixed> $c
     * @return array<string, mixed>
     */
    public function restore(array $c, float $deadline): array
    {
        $pdo = $this->db->pdo();
        $mode = (string) $pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();
        $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        $pdo->exec("SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'");
        try {
            if (!$c['dropped']) {
                foreach (array_diff($this->tables(), $c['tables']) as $extra) {
                    $pdo->exec('DROP TABLE IF EXISTS `' . $extra . '`');
                }
                $c['dropped'] = true;
            }
            $gz = gzopen($this->path((string) $c['file']), 'rb');
            if ($gz === false) {
                throw new \RuntimeException('Backup file unreadable: ' . $c['file']);
            }
            try {
                if ($c['pos'] > 0 && gzseek($gz, (int) $c['pos']) !== 0) {
                    throw new \RuntimeException('Cannot seek in the backup file.');
                }
                $first = true;
                while ($first || microtime(true) < $deadline) {
                    $first = false;
                    $line = gzgets($gz);
                    if ($line === false) {
                        $c['done'] = true;
                        break;
                    }
                    $statement = rtrim($line, "\r\n");
                    if ($statement !== '' && !str_starts_with($statement, '-- ')) {
                        $pdo->exec($statement);
                    }
                    $c['pos'] = gztell($gz);
                }
            } finally {
                gzclose($gz);
            }
        } finally {
            $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
            $pdo->exec('SET SQL_MODE=' . $pdo->quote($mode));
        }

        return $c;
    }

    /**
     * One INSERT of up to BATCH_ROWS rows: keyset pagination on a single-column primary key,
     * ordered offset otherwise.
     *
     * @return array{0:string,1:int,2:mixed}
     */
    private function batch(string $table, mixed $key, int $offset): array
    {
        $columns = [];
        foreach ($this->db->fetchAll('SHOW COLUMNS FROM `' . $table . '`') as $col) {
            if (!str_contains(strtoupper((string) ($col['Extra'] ?? '')), 'GENERATED')) {
                $columns[] = (string) $col['Field'];
            }
        }
        $pk = array_map(
            static fn (array $r): string => (string) $r['Column_name'],
            $this->db->fetchAll('SHOW KEYS FROM `' . $table . "` WHERE `Key_name` = 'PRIMARY'"),
        );
        $list = implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $columns));
        $sql = 'SELECT ' . $list . ' FROM `' . $table . '`';
        $params = [];
        if (count($pk) === 1) {
            if ($key !== null) {
                $sql .= ' WHERE `' . $pk[0] . '` > ?';
                $params[] = $key;
            }
            $sql .= ' ORDER BY `' . $pk[0] . '` LIMIT ' . self::BATCH_ROWS;
        } else {
            $order = $pk !== [] ? $pk : $columns;
            $sql .= ' ORDER BY ' . implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $order))
                . ' LIMIT ' . self::BATCH_ROWS . ' OFFSET ' . $offset;
        }
        $rows = $this->db->fetchAll($sql, $params);
        if ($rows === []) {
            return ['', 0, $key];
        }
        $pdo = $this->db->pdo();
        $values = [];
        foreach ($rows as $row) {
            $values[] = '(' . implode(', ', array_map(static fn (mixed $v): string => self::literal($pdo, $v), $row)) . ')';
        }
        $last = count($pk) === 1 ? $rows[count($rows) - 1][$pk[0]] : null;

        return ['INSERT INTO `' . $table . '` (' . $list . ') VALUES ' . implode(', ', $values) . ";\n", count($rows), $last];
    }

    /**
     * SQL literal on one line: NULL, numbers, quoted UTF-8 text (newlines escaped by quote()), else 0xHEX.
     */
    private static function literal(\PDO $pdo, mixed $value): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value)) {
            return json_encode($value, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        }
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }
        $value = (string) $value;
        if ($value === '') {
            return "''";
        }
        if (preg_match('//u', $value) === 1 && !str_contains($value, "\0")) {
            $quoted = (string) $pdo->quote($value);
            if (!str_contains($quoted, "\n") && !str_contains($quoted, "\r")) {
                return $quoted;
            }
        }

        return '0x' . bin2hex($value);
    }

    private function append(string $path, string $data): void
    {
        $gz = gzopen($path, 'ab6');
        if ($gz === false || gzwrite($gz, $data) !== strlen($data)) {
            if ($gz !== false) {
                gzclose($gz);
            }
            throw new \RuntimeException('Cannot write the backup file (disk full?).');
        }
        gzclose($gz);
    }
}
