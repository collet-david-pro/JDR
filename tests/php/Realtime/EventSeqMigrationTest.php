<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

/**
 * Migration 0003_events_seq: portable SQL (projet.md 8.2), replayable, one row id = 1.
 */
final class EventSeqMigrationTest extends DbTestCase
{
    protected function tearDown(): void
    {
        self::dropTestTables();
    }

    public function testAppliesAndReplays(): void
    {
        self::dropTestTables();
        $db = self::newDb();
        $done = (new Runner($db, self::migrationsDir()))->runAll();
        self::assertContains('0003', array_column($done, 'version'));
        self::assertSame([['id' => 1, 'purged_upto' => 0]], array_map(
            static fn (array $r): array => ['id' => (int) $r['id'], 'purged_upto' => (int) $r['purged_upto']],
            $db->fetchAll('SELECT * FROM ' . $db->t('event_seq')),
        ));
        self::assertTrue($db->indexExists('events', 'idx_channel_id'));

        // Replay after a partial failure: same file run again, nothing duplicated.
        $db->execute('UPDATE ' . $db->t('event_seq') . ' SET `purged_upto` = 12');
        $db->execute('DELETE FROM ' . $db->t('schema_migrations') . " WHERE `version` = '0003'");
        (new Runner($db, self::migrationsDir()))->runAll();
        self::assertSame(1, (int) $db->fetchValue('SELECT COUNT(*) FROM ' . $db->t('event_seq')));
        self::assertSame(12, (int) $db->fetchValue('SELECT `purged_upto` FROM ' . $db->t('event_seq')), 'the mark survives a replay');
    }

    public function testPortableSql(): void
    {
        $sql = (string) preg_replace('/^\s*--.*$/m', '', (string) file_get_contents(self::migrationsDir() . '/0003_events_seq.sql'));
        foreach (['/\bENUM\s*\(/i', '/\bCHECK\s*\(/i', '/\bGENERATED\b/i', '/\bJSON_[A-Z]+\s*\(/i', '/ALGORITHM\s*=\s*INSTANT/i',
            '/\bTRIGGER\b/i', '/\bPROCEDURE\b/i', '/ADD\s+(COLUMN\s+)?IF\s+NOT\s+EXISTS/i', '/DEFAULT\s*\(/i'] as $pattern) {
            self::assertDoesNotMatchRegularExpression($pattern, $sql, $pattern);
        }
        self::assertStringContainsString('-- @idempotent-ddl', (string) file_get_contents(self::migrationsDir() . '/0003_events_seq.sql'));
    }
}
