<?php

/*
 * 0006_notes_audience: who a map note is shared with (etapes P09, D3).
 *
 * - map_notes.audience: gm | players | all (default gm). gm_only stays filled (= audience is gm);
 *   an old row with gm_only = 0 becomes "all", the only audience it could mean.
 * - map_note_users: the accounts of the "players" audience.
 * Replayable, compatible MySQL 5.7+ / MariaDB 10.3+ (no ADD COLUMN IF NOT EXISTS).
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
        $notes = $db->t('map_notes');
        if (!$db->columnExists('map_notes', 'audience')) {
            $db->execute('ALTER TABLE ' . $notes . " ADD COLUMN `audience` VARCHAR(10) NOT NULL DEFAULT 'gm' AFTER `gm_only`");
            $db->execute('UPDATE ' . $notes . " SET `audience` = 'all' WHERE `gm_only` = 0");
        }
        $prefix = $db->prefix();
        $db->execute(
            'CREATE TABLE IF NOT EXISTS ' . $db->t('map_note_users') . ' ('
            . '`note_id` BIGINT UNSIGNED NOT NULL, '
            . '`user_id` BIGINT UNSIGNED NOT NULL, '
            . 'PRIMARY KEY (`note_id`, `user_id`), '
            . 'KEY `idx_user` (`user_id`), '
            . 'CONSTRAINT `fk_' . $prefix . 'map_note_users_note` FOREIGN KEY (`note_id`) REFERENCES ' . $notes . ' (`id`) ON DELETE CASCADE, '
            . 'CONSTRAINT `fk_' . $prefix . 'map_note_users_user` FOREIGN KEY (`user_id`) REFERENCES ' . $db->t('users') . ' (`id`) ON DELETE CASCADE'
            . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC',
        );
    }
};
