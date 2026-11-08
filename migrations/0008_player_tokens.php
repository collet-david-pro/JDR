<?php

/*
 * 0008_player_tokens: player-made tokens (etapes A-FAIRE n° 2).
 *
 * - player_tokens: the personal collection of an account (name, rendered PNG asset, optional
 *   source portrait asset, design JSON to edit the token again).
 * - game_token_choices: the token a member chose for a game (one per game and user).
 * - tokens.gm_image_forced: the GM keeps their own image instead of the player's (reversible).
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
        $prefix = $db->prefix();
        $engine = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC';
        $db->execute(
            'CREATE TABLE IF NOT EXISTS ' . $db->t('player_tokens') . ' ('
            . '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, '
            . '`user_id` BIGINT UNSIGNED NOT NULL, '
            . '`name` VARCHAR(80) NOT NULL, '
            . '`asset_id` BIGINT UNSIGNED NULL, '
            . '`source_asset_id` BIGINT UNSIGNED NULL, '
            . '`design` TEXT NOT NULL, '
            . '`created_at` DATETIME NOT NULL, '
            . '`updated_at` DATETIME NOT NULL, '
            . 'PRIMARY KEY (`id`), '
            . 'KEY `idx_user` (`user_id`), '
            . 'KEY `idx_asset` (`asset_id`), '
            . 'KEY `idx_source_asset` (`source_asset_id`), '
            . 'CONSTRAINT `fk_' . $prefix . 'player_tokens_user` FOREIGN KEY (`user_id`) REFERENCES ' . $db->t('users') . ' (`id`) ON DELETE CASCADE, '
            . 'CONSTRAINT `fk_' . $prefix . 'player_tokens_asset` FOREIGN KEY (`asset_id`) REFERENCES ' . $db->t('assets') . ' (`id`) ON DELETE SET NULL, '
            . 'CONSTRAINT `fk_' . $prefix . 'player_tokens_source` FOREIGN KEY (`source_asset_id`) REFERENCES ' . $db->t('assets') . ' (`id`) ON DELETE SET NULL'
            . ')' . $engine,
        );
        $db->execute(
            'CREATE TABLE IF NOT EXISTS ' . $db->t('game_token_choices') . ' ('
            . '`game_id` BIGINT UNSIGNED NOT NULL, '
            . '`user_id` BIGINT UNSIGNED NOT NULL, '
            . '`player_token_id` BIGINT UNSIGNED NOT NULL, '
            . '`updated_at` DATETIME NOT NULL, '
            . 'PRIMARY KEY (`game_id`, `user_id`), '
            . 'KEY `idx_player_token` (`player_token_id`), '
            . 'KEY `idx_user` (`user_id`), '
            . 'CONSTRAINT `fk_' . $prefix . 'game_token_choices_game` FOREIGN KEY (`game_id`) REFERENCES ' . $db->t('games') . ' (`id`) ON DELETE CASCADE, '
            . 'CONSTRAINT `fk_' . $prefix . 'game_token_choices_user` FOREIGN KEY (`user_id`) REFERENCES ' . $db->t('users') . ' (`id`) ON DELETE CASCADE, '
            . 'CONSTRAINT `fk_' . $prefix . 'game_token_choices_token` FOREIGN KEY (`player_token_id`) REFERENCES ' . $db->t('player_tokens') . ' (`id`) ON DELETE CASCADE'
            . ')' . $engine,
        );
        if (!$db->columnExists('tokens', 'gm_image_forced')) {
            $db->execute('ALTER TABLE ' . $db->t('tokens') . ' ADD COLUMN `gm_image_forced` TINYINT(1) NOT NULL DEFAULT 0 AFTER `ring_color`');
        }
    }
};
