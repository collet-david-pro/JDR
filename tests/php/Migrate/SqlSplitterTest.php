<?php

declare(strict_types=1);

namespace JDR\Tests\Migrate;

use JDR\Migrate\SqlSplitter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../Support/boot.php';

final class SqlSplitterTest extends TestCase
{
    /**
     * @return array<string, array{string, list<string>}>
     */
    public static function cases(): array
    {
        return [
            'simple' => ["SELECT 1; SELECT 2;", ['SELECT 1', 'SELECT 2']],
            'no trailing semicolon' => ["SELECT 1;\nSELECT 2", ['SELECT 1', 'SELECT 2']],
            'empty statements dropped' => [";; SELECT 1;;\n;", ['SELECT 1']],
            'semicolon in single quotes' => [
                "INSERT INTO t VALUES ('a;b'); SELECT 2",
                ["INSERT INTO t VALUES ('a;b')", 'SELECT 2'],
            ],
            'semicolon in double quotes' => ['SELECT "x;y"; SELECT 2', ['SELECT "x;y"', 'SELECT 2']],
            'semicolon in backticks' => ['SELECT `we;ird` FROM t; SELECT 2', ['SELECT `we;ird` FROM t', 'SELECT 2']],
            'backslash-escaped quote' => ["SELECT 'it\\'s;fine'; SELECT 2", ["SELECT 'it\\'s;fine'", 'SELECT 2']],
            'doubled quote' => ["SELECT 'it''s;fine'; SELECT 2", ["SELECT 'it''s;fine'", 'SELECT 2']],
            'escaped backslash before closing quote' => ["SELECT 'a\\\\'; SELECT 2", ["SELECT 'a\\\\'", 'SELECT 2']],
            'double-dash comment' => ["SELECT 1; -- comment; with semicolon\nSELECT 2", ['SELECT 1', 'SELECT 2']],
            'double-dash comment at end without newline' => ["SELECT 1; --", ['SELECT 1']],
            'double-dash without space is not a comment' => ["SELECT 5--3; SELECT 2", ['SELECT 5--3', 'SELECT 2']],
            'hash comment' => ["SELECT 1; # it's a comment; really\nSELECT 2", ['SELECT 1', 'SELECT 2']],
            'block comment' => ["SELECT /* a; 'b */ 1; /* multi\nline; */ SELECT 2", ['SELECT   1', 'SELECT 2']],
            'executable comment kept' => [
                "/*!40101 SET NAMES utf8mb4 */; SELECT 2",
                ['/*!40101 SET NAMES utf8mb4 */', 'SELECT 2'],
            ],
            'comment markers inside strings' => [
                "INSERT INTO t VALUES ('-- not a comment', '# nor this', '/* nor this */'); SELECT 2",
                ["INSERT INTO t VALUES ('-- not a comment', '# nor this', '/* nor this */')", 'SELECT 2'],
            ],
            'quote inside comment is ignored' => ["-- don't break\nSELECT 1; SELECT 2", ['SELECT 1', 'SELECT 2']],
            'only comments' => ["-- a\n# b\n/* c */", []],
            'multiline statement' => [
                "CREATE TABLE t (\n  a INT,\n  b TEXT\n);\n",
                ["CREATE TABLE t (\n  a INT,\n  b TEXT\n)"],
            ],
            'marker line is a comment' => ["-- @idempotent-ddl\nCREATE TABLE t (a INT);", ['CREATE TABLE t (a INT)']],
            'unterminated string swallows the rest' => ["SELECT 'abc; SELECT 2", ["SELECT 'abc; SELECT 2"]],
            'crlf line endings' => ["SELECT 1;\r\n-- c\r\nSELECT 2;\r\n", ['SELECT 1', 'SELECT 2']],
        ];
    }

    /**
     * @param list<string> $expected
     */
    #[DataProvider('cases')]
    public function testSplit(string $sql, array $expected): void
    {
        self::assertSame($expected, SqlSplitter::split($sql));
    }

    public function testInitialMigrationSplitsIntoExpectedStatementCount(): void
    {
        $sql = (string) file_get_contents(dirname(__DIR__, 3) . '/migrations/0001_initial.sql');
        $statements = SqlSplitter::split($sql);
        $creates = array_filter($statements, static fn (string $s) => str_starts_with($s, 'CREATE TABLE IF NOT'));
        $alters = array_filter($statements, static fn (string $s): bool => str_starts_with($s, 'ALTER TABLE'));
        self::assertCount(39, $creates);
        self::assertCount(1, $alters);
        self::assertCount(40, $statements);
    }
}
