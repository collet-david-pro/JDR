<?php

/*
 * 0005_floor_uids: floors get a client-visible uid (etapes P09, P9a1).
 *
 * map_floors.uid CHAR(21) NOT NULL, UNIQUE (map_id, uid). Existing floors get "f1", "f2"... per
 * map in the order of the document export (sort_order, level, id). Replayable after a partial
 * failure: each step checks what is already done (information_schema), no "IF NOT EXISTS" column
 * syntax (MySQL 5.7 / MariaDB 10.3 compatible).
 * NEVER modify this file once delivered: any change = new migration.
 */

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Migrate\Migration;
use JDR\Migrate\MigrationLogger;

return new class implements Migration {
    public function up(Db $db, MigrationLogger $log): void
    {
        $table = $db->t('map_floors');
        if (!$this->hasColumn($db, 'map_floors', 'uid')) {
            $db->pdo()->exec('ALTER TABLE ' . $table . ' ADD COLUMN `uid` CHAR(21) NULL AFTER `map_id`');
        }
        $rows = $db->fetchAll(
            'SELECT `id`, `map_id`, `uid` FROM ' . $table . ' ORDER BY `map_id`, `sort_order`, `level`, `id`'
        );
        $perMap = [];
        foreach ($rows as $row) {
            $perMap[(int) $row['map_id']][] = $row;
        }
        foreach ($perMap as $floors) {
            $missing = false;
            foreach ($floors as $f) {
                $missing = $missing || $f['uid'] === null || $f['uid'] === '';
            }
            if (!$missing) {
                continue;
            }
            // Renumber the whole map (a partial run leaves no mix of old and new uids).
            foreach ($floors as $i => $f) {
                $db->execute('UPDATE ' . $table . ' SET `uid` = ? WHERE `id` = ?', ['__' . $f['id'], $f['id']]);
            }
            foreach ($floors as $i => $f) {
                $db->execute('UPDATE ' . $table . ' SET `uid` = ? WHERE `id` = ?', ['f' . ($i + 1), $f['id']]);
            }
        }
        $db->pdo()->exec('ALTER TABLE ' . $table . ' MODIFY COLUMN `uid` CHAR(21) NOT NULL');
        if (!$this->hasIndex($db, 'map_floors', 'uq_map_uid')) {
            $db->pdo()->exec('ALTER TABLE ' . $table . ' ADD UNIQUE KEY `uq_map_uid` (`map_id`, `uid`)');
        }
        $log->info('map_floors.uid ready.');
    }

    private function hasColumn(Db $db, string $name, string $column): bool
    {
        return (int) $db->fetchValue(
            'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [$db->prefix() . $name, $column]
        ) > 0;
    }

    private function hasIndex(Db $db, string $name, string $index): bool
    {
        return (int) $db->fetchValue(
            'SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
            [$db->prefix() . $name, $index]
        ) > 0;
    }
};
