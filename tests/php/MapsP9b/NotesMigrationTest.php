<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

use JDR\Migrate\CallbackLogger;
use JDR\Migrate\Migration;

/**
 * Migration 0006_notes_audience: replayable, an old shared note becomes "all".
 */
final class NotesMigrationTest extends MapsP9bTestCase
{
    public function testReplayableAndConvertsOldRows(): void
    {
        $w = $this->arena();
        $map = (int) $w['map'];
        $notes = $this->db->t('map_notes');
        $insert = 'INSERT INTO ' . $notes . " (`map_id`, `uid`, `title`, `body`, `gm_only`, `updated_at`) VALUES (?, ?, 't', '', ?, UTC_TIMESTAMP())";

        // The state before the migration.
        $this->db->execute('DROP TABLE ' . $this->db->t('map_note_users'));
        $this->db->execute('ALTER TABLE ' . $notes . ' DROP COLUMN `audience`');
        $this->db->execute($insert, [$map, 'old-private', 1]);
        $this->db->execute($insert, [$map, 'old-shared', 0]);

        /** @var Migration $migration */
        $migration = require self::migrationsDir() . '/0006_notes_audience.php';
        $log = new CallbackLogger(static function (): void {
        });
        $migration->up($this->db, $log);
        // Replayed: nothing fails, nothing changes.
        $this->db->execute('UPDATE ' . $notes . " SET `audience` = 'players' WHERE `uid` = 'old-private'");
        $migration->up($this->db, $log);

        self::assertSame('players', $this->noteRow($w['map'], 'old-private')['audience']);
        self::assertSame('all', $this->noteRow($w['map'], 'old-shared')['audience']);
        self::assertTrue($this->db->tableExists('map_note_users'));

        // A note deleted takes its accounts with it, as does an account.
        $note = (int) $this->noteRow($w['map'], 'old-private')['id'];
        $this->db->execute('INSERT INTO ' . $this->db->t('map_note_users') . ' (`note_id`, `user_id`) VALUES (?, ?)', [$note, $this->userId('Bob')]);
        $this->db->execute('DELETE FROM ' . $notes . ' WHERE `id` = ?', [$note]);
        self::assertSame(0, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('map_note_users')));
    }

    public function testRequiredVersionAcceptsTheGapOfNumbering(): void
    {
        self::assertSame('0007', \REQUIRED_DB_VERSION);
        self::assertFileExists(self::migrationsDir() . '/0006_notes_audience.php');
    }
}
