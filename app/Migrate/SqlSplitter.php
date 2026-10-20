<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * Splits an SQL script into individual statements on `;`, safely:
 * - ignores `;` inside '...', "..." and `...` (backslash escapes and doubled quotes handled);
 * - strips comments: `-- ` (MySQL requires whitespace/control char or end after `--`),
 *   `#` to end of line, and block comments; executable comments (MySQL/MariaDB
 *   version comments and optimizer hints) are kept verbatim;
 * - drops empty statements and trims the rest.
 *
 * DELIMITER is not supported (stored procedures and triggers are forbidden, §8.2).
 */
final class SqlSplitter
{
    /**
     * @return list<string>
     */
    public static function split(string $sql): array
    {
        $statements = [];
        $current = '';
        $len = strlen($sql);
        $i = 0;

        while ($i < $len) {
            $c = $sql[$i];
            $next = $i + 1 < $len ? $sql[$i + 1] : '';

            // Quoted strings and identifiers.
            if ($c === "'" || $c === '"' || $c === '`') {
                $end = self::skipQuoted($sql, $i, $len, $c);
                $current .= substr($sql, $i, $end - $i);
                $i = $end;
                continue;
            }

            // "-- " comment (MySQL: "--" must be followed by whitespace/control char or end of input).
            if ($c === '-' && $next === '-' && ($i + 2 >= $len || ord($sql[$i + 2]) <= 32)) {
                $i = self::skipToEol($sql, $i, $len);
                $current .= ' ';
                continue;
            }

            // "#" comment.
            if ($c === '#') {
                $i = self::skipToEol($sql, $i, $len);
                $current .= ' ';
                continue;
            }

            // Block comment.
            if ($c === '/' && $next === '*') {
                $close = strpos($sql, '*/', $i + 2);
                $end = $close === false ? $len : $close + 2;
                $third = $i + 2 < $len ? $sql[$i + 2] : '';
                if ($third === '!' || $third === '+' || ($third === 'M' && substr($sql, $i + 2, 2) === 'M!')) {
                    // Executable comment (/*! ... */, /*M! ... */) or optimizer hint (/*+ ... */): keep.
                    $current .= substr($sql, $i, $end - $i);
                } else {
                    $current .= ' ';
                }
                $i = $end;
                continue;
            }

            if ($c === ';') {
                self::push($statements, $current);
                $current = '';
                $i++;
                continue;
            }

            $current .= $c;
            $i++;
        }

        self::push($statements, $current);

        return $statements;
    }

    /**
     * Returns the offset just after the closing quote (or end of input).
     */
    private static function skipQuoted(string $sql, int $start, int $len, string $quote): int
    {
        $i = $start + 1;
        while ($i < $len) {
            $c = $sql[$i];
            if ($c === '\\' && $quote !== '`') {
                $i += 2;
                continue;
            }
            if ($c === $quote) {
                if ($i + 1 < $len && $sql[$i + 1] === $quote) {
                    $i += 2; // Doubled quote = escaped quote.
                    continue;
                }

                return $i + 1;
            }
            $i++;
        }

        return $len;
    }

    private static function skipToEol(string $sql, int $start, int $len): int
    {
        $eol = strpos($sql, "\n", $start);

        return $eol === false ? $len : $eol;
    }

    /**
     * @param list<string> $statements
     */
    private static function push(array &$statements, string $statement): void
    {
        $statement = trim($statement);
        if ($statement !== '') {
            $statements[] = $statement;
        }
    }
}
