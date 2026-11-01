<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9;

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

require_once __DIR__ . '/../Support/DbTestCase.php';

/**
 * Migration 0005_floor_uids (P9a1): uid filled "f1", "f2"... per map in the export order, UNIQUE(map_id, uid),
 * replayable.
 */
final class FloorUidMigrationTest extends DbTestCase
{
    private Db $db;

    protected function setUp(): void
    {
        $this->db = self::newDb();
        self::dropTestTables($this->db);
    }

    public static function tearDownAfterClass(): void
    {
        self::dropTestTables();
    }

    private function runUpTo(string $last): void
    {
        $files = ['0001_initial.sql' => (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql')];
        if ($last === '0005') {
            $files['0005_floor_uids.php'] = (string) file_get_contents(self::migrationsDir() . '/0005_floor_uids.php');
        }
        $dir = self::makeMigrationsDir($files);
        try {
            (new Runner($this->db, $dir))->runAll();
        } finally {
            self::removeDir($dir);
        }
    }

    public function testBackfillsUidsInExportOrderAndIsReplayable(): void
    {
        $this->runUpTo('0001');
        $db = $this->db;
        $now = gmdate('Y-m-d H:i:s');
        $db->execute('INSERT INTO ' . $db->t('users') . ' (email, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['gm@example.test', 'gm', 'x', $now, $now]);
        $userId = (int) $db->lastInsertId();
        $db->execute('INSERT INTO ' . $db->t('games') . ' (gm_user_id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [$userId, 'G', '{}', $now, $now]);
        $gameId = (int) $db->lastInsertId();
        $maps = [];
        foreach (['A', 'B'] as $name) {
            $db->execute(
                'INSERT INTO ' . $db->t('maps') . ' (game_id, owner_user_id, name, width_cells, height_cells, ambient, palette, layers, format_version, created_at, updated_at) '
                . 'VALUES (?, ?, ?, 30, 20, ?, ?, ?, 1, ?, ?)',
                [$gameId, $userId, $name, '{}', '[null]', '[]', $now, $now]
            );
            $maps[$name] = (int) $db->lastInsertId();
        }
        // Map A: ids created in an order different from the display order (sort_order, level, id).
        foreach ([['Haut', 1, 2], ['Rez', 0, 0], ['Cave', -1, 1]] as [$floor, $level, $sort]) {
            $db->execute('INSERT INTO ' . $db->t('map_floors') . ' (map_id, level, name, sort_order) VALUES (?, ?, ?, ?)', [$maps['A'], $level, $floor, $sort]);
        }
        $db->execute('INSERT INTO ' . $db->t('map_floors') . ' (map_id, level, name, sort_order) VALUES (?, 0, ?, 0)', [$maps['B'], 'Rez B']);

        $this->runUpTo('0005');
        $uids = static fn (int $mapId): array => array_column($db->fetchAll(
            'SELECT `name`, `uid` FROM ' . $db->t('map_floors') . ' WHERE `map_id` = ? ORDER BY `sort_order`, `level`, `id`',
            [$mapId]
        ), 'uid', 'name');
        self::assertSame(['Rez' => 'f1', 'Cave' => 'f2', 'Haut' => 'f3'], $uids($maps['A']));
        self::assertSame(['Rez B' => 'f1'], $uids($maps['B']));

        // Unique per map.
        try {
            $db->execute('INSERT INTO ' . $db->t('map_floors') . ' (map_id, uid, level, name, sort_order) VALUES (?, ?, 5, ?, 5)', [$maps['A'], 'f1', 'Doublon']);
            self::fail('uid must be unique in a map');
        } catch (\PDOException $e) {
            self::assertSame('23000', (string) $e->getCode());
        }

        // Replay: nothing changes, and a floor given a uid by hand keeps it.
        $db->execute('UPDATE ' . $db->t('map_floors') . ' SET `uid` = ? WHERE `name` = ?', ['grenier', 'Haut']);
        $migration = require self::migrationsDir() . '/0005_floor_uids.php';
        $migration->up($db, new CallbackLogger());
        self::assertSame(['Rez' => 'f1', 'Cave' => 'f2', 'Haut' => 'grenier'], $uids($maps['A']));
        self::assertSame(['Rez B' => 'f1'], $uids($maps['B']));
    }
}
