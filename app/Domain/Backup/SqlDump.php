<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

/**
 * Whitelist of the statements of a database backup written by SqlBackup (one statement per line),
 * with the rewriting of the table prefix. A dump comes from an upload: it is never run as is.
 * Accepted: comments ("-- "), the header SETs, DROP TABLE IF EXISTS / CREATE TABLE / INSERT INTO on tables
 * of the target prefix (never php_sessions). An INSERT may only carry literals (NULL, numbers, quoted strings,
 * 0x...), a CREATE only a column list and known table options; one statement per line (no ";", comment or
 * SELECT outside the quotes). Anything else => backup.invalid_file.
 * Prefix rewriting: in DROP / CREATE every backquoted identifier starting with the old prefix (or fk_<old>),
 * in an INSERT only the table name.
 */
final class SqlDump
{
    public const HEADER = '/^-- JDR database backup, version (\S+), (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC, prefix ([A-Za-z0-9_]*)$/D';

    public const SKIP = 'skip';
    public const SET = 'set';
    public const DROP = 'drop';
    public const CREATE = 'create';
    public const INSERT = 'insert';
    public const END = 'end';

    private const SETS = [
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS=0;',
        'SET FOREIGN_KEY_CHECKS=1;',
        "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
        "SET time_zone='+00:00';",
    ];
    private const SKIPPED_TABLES = ['php_sessions'];
    private const TABLE_OPTIONS = 'ENGINE|AUTO_INCREMENT|CHARSET|CHARACTER SET|COLLATE|ROW_FORMAT|COMMENT|STATS_PERSISTENT'
        . '|STATS_AUTO_RECALC|STATS_SAMPLE_PAGES|PAGE_CHECKSUM|TRANSACTIONAL|KEY_BLOCK_SIZE|CHECKSUM|PACK_KEYS|DELAY_KEY_WRITE';

    /**
     * @return array{version:string, date:string, prefix:string}|null
     */
    public static function header(string $line): ?array
    {
        if (preg_match(self::HEADER, $line, $m) !== 1) {
            return null;
        }

        return ['version' => $m[1], 'date' => $m[2], 'prefix' => $m[3]];
    }

    /**
     * @return array{0:string, 1:string|null, 2:string} kind, table (target prefix), statement to run
     * @throws BackupException backup.invalid_file
     */
    public static function check(string $line, string $from, string $to): array
    {
        if ($line === '') {
            return [self::SKIP, null, ''];
        }
        if (str_starts_with($line, '-- ')) {
            return [$line === '-- end' ? self::END : self::SKIP, null, ''];
        }
        if (in_array($line, self::SETS, true)) {
            return [self::SET, null, $line];
        }
        if (str_starts_with($line, 'DROP TABLE IF EXISTS `')) {
            if (preg_match('/^DROP TABLE IF EXISTS `([A-Za-z0-9_]{1,64})`;$/D', $line, $m) !== 1) {
                throw BackupException::invalid('statement');
            }
            $table = self::table($m[1], $from, $to);

            return [self::DROP, $table, 'DROP TABLE IF EXISTS `' . $table . '`'];
        }
        if (str_starts_with($line, 'CREATE TABLE `')) {
            return self::create($line, $from, $to);
        }
        if (str_starts_with($line, 'INSERT INTO `')) {
            return self::insert($line, $from, $to);
        }
        throw BackupException::invalid('statement');
    }

    /**
     * @return array{0:string, 1:string, 2:string}
     */
    private static function create(string $line, string $from, string $to): array
    {
        if (preg_match('/^CREATE TABLE `([A-Za-z0-9_]{1,64})` \(/', $line, $m) !== 1) {
            throw BackupException::invalid('statement');
        }
        $table = self::table($m[1], $from, $to);
        $sql = $from === $to ? $line : (string) preg_replace_callback(
            '/`([^`]*)`/',
            static fn (array $id): string => '`' . self::rename($id[1], $from, $to) . '`',
            $line,
        );
        $bare = self::unquote($sql);
        if ($bare === null || !str_ends_with($bare, ';') || substr_count($bare, ';') !== 1
            || str_contains($bare, '/*') || str_contains($bare, '#') || str_contains($bare, '--')) {
            throw BackupException::invalid('statement');
        }
        $open = strpos($bare, '(');
        $depth = 0;
        $close = null;
        for ($i = (int) $open, $n = strlen($bare); $i < $n; $i++) {
            $c = $bare[$i];
            if ($c === '(') {
                $depth++;
            } elseif ($c === ')' && --$depth === 0) {
                $close = $i;
                break;
            }
        }
        $tail = $close === null ? null : substr($bare, $close + 1);
        $option = '\s+(?:DEFAULT\s+)?(?:' . self::TABLE_OPTIONS . ')\s*=\s*(?:\'\'|[A-Za-z0-9_]+)';
        if ($tail === null || preg_match('/^(?:' . $option . ')*;$/Di', $tail) !== 1
            || preg_match('/\bSELECT\b/i', substr($bare, 0, $close)) === 1) {
            throw BackupException::invalid('statement');
        }

        return [self::CREATE, $table, substr($sql, 0, -1)];
    }

    /**
     * @return array{0:string, 1:string, 2:string}
     */
    private static function insert(string $line, string $from, string $to): array
    {
        if (preg_match('/^INSERT INTO `([A-Za-z0-9_]{1,64})` \((`[A-Za-z0-9_]{1,64}`(?:, `[A-Za-z0-9_]{1,64}`)*)\) VALUES /', $line, $m) !== 1
            || !str_ends_with($line, ';')) {
            throw BackupException::invalid('statement');
        }
        $values = substr($line, strlen($m[0]), -1);
        if (!self::literalRows($values)) {
            throw BackupException::invalid('statement');
        }
        $table = self::table($m[1], $from, $to);

        return [self::INSERT, $table, 'INSERT INTO `' . $table . '` (' . $m[2] . ') VALUES ' . $values];
    }

    private static function table(string $name, string $from, string $to): string
    {
        $table = self::rename($name, $from, $to);
        if (!str_starts_with($table, $to) || strlen($table) > 64 || strlen($table) === strlen($to)
            || in_array(substr($table, strlen($to)), self::SKIPPED_TABLES, true)) {
            throw BackupException::invalid('foreign_table', ['table' => $name]);
        }

        return $table;
    }

    private static function rename(string $id, string $from, string $to): string
    {
        if ($from === $to || $from === '') {
            return $id;
        }
        if (str_starts_with($id, $from)) {
            return $to . substr($id, strlen($from));
        }
        if (str_starts_with($id, 'fk_' . $from)) {
            return 'fk_' . $to . substr($id, strlen($from) + 3);
        }

        return $id;
    }

    /**
     * The statement with the contents of '...', "..." and `...` removed (quotes kept), null if one is not closed.
     */
    private static function unquote(string $s): ?string
    {
        $out = '';
        $n = strlen($s);
        $i = 0;
        while ($i < $n) {
            $j = strcspn($s, "'\"`", $i);
            $out .= substr($s, $i, $j);
            $i += $j;
            if ($i >= $n) {
                break;
            }
            $q = $s[$i];
            $i++;
            while (true) {
                $i += strcspn($s, $q === '`' ? '`' : $q . '\\', $i);
                if ($i >= $n) {
                    return null;
                }
                if ($s[$i] === '\\') {
                    $i += 2;
                    if ($i >= $n) {
                        return null;
                    }
                    continue;
                }
                if ($i + 1 < $n && $s[$i + 1] === $q) {
                    $i += 2;
                    continue;
                }
                $i++;
                break;
            }
            $out .= $q . $q;
        }

        return $out;
    }

    /**
     * "(v, v), (v, v)" where every v is NULL, a number, 0xHEX or a quoted string (as SqlBackup writes them).
     */
    private static function literalRows(string $s): bool
    {
        $n = strlen($s);
        $i = 0;
        while (true) {
            if ($i >= $n || $s[$i] !== '(') {
                return false;
            }
            $i++;
            while (true) {
                $i = self::literal($s, $i, $n);
                if ($i < 0 || $i >= $n) {
                    return false;
                }
                if ($s[$i] === ')') {
                    $i++;
                    break;
                }
                if ($s[$i] !== ',' || $i + 1 >= $n || $s[$i + 1] !== ' ') {
                    return false;
                }
                $i += 2;
            }
            if ($i === $n) {
                return true;
            }
            if ($i + 1 >= $n || $s[$i] !== ',' || $s[$i + 1] !== ' ') {
                return false;
            }
            $i += 2;
        }
    }

    /**
     * Position after the literal starting at $i, -1 when there is none.
     */
    private static function literal(string $s, int $i, int $n): int
    {
        if ($i >= $n) {
            return -1;
        }
        $c = $s[$i];
        if ($c === "'") {
            $i++;
            while (true) {
                $i += strcspn($s, "'\\", $i);
                if ($i >= $n) {
                    return -1;
                }
                if ($s[$i] === '\\') {
                    $i += 2;
                    if ($i >= $n) {
                        return -1;
                    }
                    continue;
                }
                if ($i + 1 < $n && $s[$i + 1] === "'") {
                    $i += 2;
                    continue;
                }

                return $i + 1;
            }
        }
        if ($c === 'N') {
            return substr($s, $i, 4) === 'NULL' ? $i + 4 : -1;
        }
        if ($c === '0' && $i + 1 < $n && $s[$i + 1] === 'x') {
            $len = strspn($s, '0123456789abcdefABCDEF', $i + 2);

            return $len > 0 ? $i + 2 + $len : -1;
        }
        if ($c === '-') {
            $i++;
        }
        $len = strspn($s, '0123456789', $i);
        if ($len === 0) {
            return -1;
        }
        $i += $len;
        if ($i < $n && $s[$i] === '.') {
            $len = strspn($s, '0123456789', $i + 1);
            if ($len === 0) {
                return -1;
            }
            $i += 1 + $len;
        }
        if ($i < $n && ($s[$i] === 'e' || $s[$i] === 'E')) {
            $i++;
            if ($i < $n && ($s[$i] === '+' || $s[$i] === '-')) {
                $i++;
            }
            $len = strspn($s, '0123456789', $i);
            if ($len === 0) {
                return -1;
            }
            $i += $len;
        }

        return $i;
    }
}
