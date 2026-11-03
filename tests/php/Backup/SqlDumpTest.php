<?php

declare(strict_types=1);

namespace JDR\Tests\Backup;

use JDR\Domain\Backup\BackupException;
use JDR\Domain\Backup\SqlDump;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/Support/boot.php';

final class SqlDumpTest extends TestCase
{
    public function testAcceptedStatementsAndPrefixRewrite(): void
    {
        self::assertSame(['version' => '0.2.0', 'date' => '2026-01-01 10:00:00', 'prefix' => 'old_'],
            SqlDump::header('-- JDR database backup, version 0.2.0, 2026-01-01 10:00:00 UTC, prefix old_'));
        self::assertSame([SqlDump::SET, null, 'SET FOREIGN_KEY_CHECKS=0;'], SqlDump::check('SET FOREIGN_KEY_CHECKS=0;', 'old_', 'new_'));
        self::assertSame([SqlDump::END, null, ''], SqlDump::check('-- end', 'old_', 'new_'));
        self::assertSame([SqlDump::DROP, 'new_users', 'DROP TABLE IF EXISTS `new_users`'], SqlDump::check('DROP TABLE IF EXISTS `old_users`;', 'old_', 'new_'));

        $create = 'CREATE TABLE `old_games` (`id` bigint NOT NULL, `old_x` varchar(20) DEFAULT \'old_; DROP\', `owner_id` bigint, '
            . 'PRIMARY KEY (`id`), CONSTRAINT `fk_old_games_owner` FOREIGN KEY (`owner_id`) REFERENCES `old_users` (`id`) ON DELETE CASCADE, '
            . 'CONSTRAINT `c1` CHECK (json_valid(`old_x`))) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT=\'a;b\';';
        [$kind, $table, $sql] = SqlDump::check($create, 'old_', 'new_');
        self::assertSame([SqlDump::CREATE, 'new_games'], [$kind, $table]);
        self::assertStringContainsString('CONSTRAINT `fk_new_games_owner` FOREIGN KEY (`owner_id`) REFERENCES `new_users`', $sql);
        self::assertStringContainsString("DEFAULT 'old_; DROP'", $sql); // strings are left alone
        self::assertStringEndsWith("COMMENT='a;b'", $sql);

        $insert = "INSERT INTO `old_notes` (`id`, `old_body`, `data`) VALUES (1, 'old_ it''s \\' ; DROP', 0x00ff), (-2, NULL, 1.5e+20), (3, '', 0);";
        self::assertSame(
            [SqlDump::INSERT, 'new_notes', "INSERT INTO `new_notes` (`id`, `old_body`, `data`) VALUES (1, 'old_ it''s \\' ; DROP', 0x00ff), (-2, NULL, 1.5e+20), (3, '', 0)"],
            SqlDump::check($insert, 'old_', 'new_'),
        );
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function refused(): iterable
    {
        yield 'delete' => ['DELETE FROM `jdr_users`;'];
        yield 'grant' => ["GRANT ALL ON *.* TO 'x'@'%';"];
        yield 'set other' => ['SET GLOBAL general_log=1;'];
        yield 'foreign table' => ['INSERT INTO `other_users` (`id`) VALUES (1);'];
        yield 'sessions' => ['DROP TABLE IF EXISTS `jdr_php_sessions`;'];
        yield 'two statements' => ['INSERT INTO `jdr_users` (`id`) VALUES (1); DELETE FROM `jdr_games`;'];
        yield 'subquery' => ['INSERT INTO `jdr_users` (`id`) VALUES ((SELECT 1));'];
        yield 'function' => ['INSERT INTO `jdr_users` (`id`) VALUES (SLEEP(5));'];
        yield 'on duplicate' => ['INSERT INTO `jdr_users` (`id`) VALUES (1) ON DUPLICATE KEY UPDATE `id` = 2;'];
        yield 'unterminated' => ["INSERT INTO `jdr_users` (`id`) VALUES ('a);"];
        yield 'create select' => ['CREATE TABLE `jdr_x` (`a` int) SELECT `password` FROM `other_users`;'];
        yield 'create select inside' => ['CREATE TABLE `jdr_x` (`a` int, SELECT 1);'];
        yield 'create comment' => ['CREATE TABLE `jdr_x` (`a` int /*!; DROP TABLE x */) ENGINE=InnoDB;'];
        yield 'create two' => ['CREATE TABLE `jdr_x` (`a` int); DROP TABLE `jdr_y`;'];
        yield 'drop other' => ['DROP TABLE IF EXISTS `mysql`;'];
        yield 'drop database' => ['DROP DATABASE `jdr`;'];
        yield 'update' => ['UPDATE `jdr_users` SET `role` = \'admin\';'];
    }

    /**
     * @dataProvider refused
     */
    public function testRefusedStatements(string $line): void
    {
        try {
            SqlDump::check($line, 'jdr_', 'jdr_');
            self::fail('Accepted: ' . $line);
        } catch (BackupException $e) {
            self::assertSame('backup.invalid_file', $e->errorCode());
        }
    }
}
