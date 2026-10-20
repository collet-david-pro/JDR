<?php

/*
 * 0002_seed: initial data (projet.md 7.4).
 *
 * - Default settings (7.2 / 7.4), inserted with INSERT IGNORE: a value already present (changed by the
 *   installer or by an admin) is never overwritten, so the migration is replayable.
 * - General asset categories (owner NULL), without duplicates on replay.
 *
 * Deferred (not part of this migration): the base asset pack (app/Seed/assets/, phase P2) and the
 * map templates (app/Seed/templates/, phase P9) will come with their own migrations.
 * NEVER modify this file once delivered: any change = new migration.
 */

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Migrate\Migration;
use JDR\Migrate\MigrationLogger;

return new class implements Migration {
    /** @var array<string, mixed> */
    private const SETTINGS = [
        'site_name' => 'JDR',
        'default_locale' => 'fr',
        'registration_mode' => 'open',
        'default_quota_bytes' => 524288000,
        'max_upload_bytes' => 10485760,
        'max_dimension_px' => 4096,
        'max_total_pixels' => 16777216,
        'max_frames' => 300,
        'max_animation_ms' => 20000,
        'events_retention_hours' => 24,
        'versions_retention' => 30,
        'trash_days' => 30,
        'session_idle_hours' => 12,
        'use_db_sessions' => false,
        'maintenance' => false,
        'smtp' => null,
    ];

    private const CATEGORIES = ['Sols', 'Murs', 'Portes', 'Mobilier', 'Nature', 'Eau', 'Lumières', 'Tokens', 'Textures'];

    public function up(Db $db, MigrationLogger $log): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $db->transaction(function (Db $db) use ($now, $log): void {
            $inserted = 0;
            foreach (self::SETTINGS as $key => $value) {
                $inserted += $db->execute(
                    'INSERT IGNORE INTO ' . $db->t('settings') . ' (`key`, `value`, `updated_at`) VALUES (?, ?, ?)',
                    [$key, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), $now]
                );
            }
            $log->info(sprintf('Default settings: %d inserted, %d kept', $inserted, count(self::SETTINGS) - $inserted));

            $created = 0;
            foreach (self::CATEGORIES as $order => $name) {
                $exists = $db->fetchValue(
                    'SELECT id FROM ' . $db->t('asset_categories')
                    . ' WHERE owner_user_id IS NULL AND parent_id IS NULL AND name = ? LIMIT 1',
                    [$name]
                );
                if ($exists === null) {
                    $db->execute(
                        'INSERT INTO ' . $db->t('asset_categories') . ' (owner_user_id, parent_id, name, sort_order)'
                        . ' VALUES (NULL, NULL, ?, ?)',
                        [$name, ($order + 1) * 10]
                    );
                    $created++;
                }
            }
            $log->info(sprintf('General asset categories: %d created', $created));
        });
    }
};
