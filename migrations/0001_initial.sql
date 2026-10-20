-- @idempotent-ddl
-- 0001_initial: complete schema (projet.md §7.2), conventions §7.1.
-- Compatible MySQL 5.7+ / MariaDB 10.3+. Replayable after a partial failure:
-- CREATE TABLE IF NOT EXISTS everywhere; the only ALTER (circular FK) is ignored when it already exists.
-- NEVER modify this file once delivered: any schema change = new migration.

-- ---------------------------------------------------------------------------
-- System
-- ---------------------------------------------------------------------------

-- Must stay identical to JDR\Migrate\Runner::schemaMigrationsDdl().
CREATE TABLE IF NOT EXISTS `{{prefix}}schema_migrations` (
  `version` VARCHAR(10) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `error` TEXT NULL,
  `applied_at` DATETIME NOT NULL,
  `duration_ms` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}settings` (
  `key` VARCHAR(100) NOT NULL,
  `value` JSON NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}rate_limits` (
  `bucket` VARCHAR(191) NOT NULL,
  `hits` INT UNSIGNED NOT NULL,
  `window_start` DATETIME NOT NULL,
  `blocked_until` DATETIME NULL,
  PRIMARY KEY (`bucket`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `{{prefix}}users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(191) NOT NULL,
  `username` VARCHAR(40) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'user',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `storage_quota_bytes` BIGINT UNSIGNED NULL,
  `storage_used_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `locale` VARCHAR(10) NOT NULL DEFAULT 'fr',
  `email_verified_at` DATETIME NULL,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email` (`email`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}audit_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(50) NOT NULL,
  `entity` VARCHAR(30) NULL,
  `entity_id` BIGINT UNSIGNED NULL,
  `data` JSON NULL,
  `ip` VARCHAR(45) NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_{{prefix}}audit_log_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}background_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `progress` JSON NOT NULL,
  `result` JSON NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_{{prefix}}background_jobs_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}user_prefs` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `key` VARCHAR(50) NOT NULL,
  `value` JSON NOT NULL,
  PRIMARY KEY (`user_id`, `key`),
  CONSTRAINT `fk_{{prefix}}user_prefs_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}remember_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `selector` CHAR(24) NOT NULL,
  `validator_hash` CHAR(64) NOT NULL,
  `user_agent` VARCHAR(255) NULL,
  `expires_at` DATETIME NOT NULL,
  `last_used_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_selector` (`selector`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_{{prefix}}remember_tokens_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}password_resets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token_hash` (`token_hash`),
  KEY `idx_user` (`user_id`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_{{prefix}}password_resets_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}password_resets_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}login_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `identifier` VARCHAR(191) NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_identifier_created` (`identifier`, `created_at`),
  KEY `idx_ip_created` (`ip`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}invitations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` CHAR(64) NOT NULL,
  `email` VARCHAR(191) NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `max_uses` INT UNSIGNED NOT NULL DEFAULT 1,
  `uses` INT UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_code_hash` (`code_hash`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_{{prefix}}invitations_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Used only when settings.use_db_sessions is enabled.
CREATE TABLE IF NOT EXISTS `{{prefix}}php_sessions` (
  `id` VARCHAR(128) NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `data` MEDIUMBLOB NOT NULL,
  `ip` VARCHAR(45) NULL,
  `last_activity` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_last_activity` (`last_activity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------------
-- Assets (created before games: games.cover_asset_id references assets)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `{{prefix}}asset_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` BIGINT UNSIGNED NULL,
  `parent_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(80) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_owner` (`owner_user_id`),
  KEY `idx_parent` (`parent_id`),
  CONSTRAINT `fk_{{prefix}}asset_categories_owner_user` FOREIGN KEY (`owner_user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}asset_categories_parent` FOREIGN KEY (`parent_id`)
    REFERENCES `{{prefix}}asset_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `owner_user_id` BIGINT UNSIGNED NULL,
  `category_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(120) NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `mime` VARCHAR(30) NOT NULL,
  `ext` VARCHAR(5) NOT NULL,
  `width` INT UNSIGNED NOT NULL,
  `height` INT UNSIGNED NOT NULL,
  `is_animated` TINYINT(1) NOT NULL DEFAULT 0,
  `frame_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `duration_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `autotile` JSON NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `thumb_size_bytes` INT UNSIGNED NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'upload',
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_uuid` (`uuid`),
  KEY `idx_owner_sha256` (`owner_user_id`, `sha256`),
  KEY `idx_owner_kind_deleted` (`owner_user_id`, `kind`, `deleted_at`),
  KEY `idx_category` (`category_id`),
  CONSTRAINT `fk_{{prefix}}assets_owner_user` FOREIGN KEY (`owner_user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}assets_category` FOREIGN KEY (`category_id`)
    REFERENCES `{{prefix}}asset_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}asset_tags` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_owner_name` (`owner_user_id`, `name`),
  CONSTRAINT `fk_{{prefix}}asset_tags_owner_user` FOREIGN KEY (`owner_user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}asset_tag_map` (
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `tag_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`asset_id`, `tag_id`),
  KEY `idx_tag` (`tag_id`),
  CONSTRAINT `fk_{{prefix}}asset_tag_map_asset` FOREIGN KEY (`asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}asset_tag_map_tag` FOREIGN KEY (`tag_id`)
    REFERENCES `{{prefix}}asset_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}asset_favorites` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`user_id`, `asset_id`),
  KEY `idx_asset` (`asset_id`),
  CONSTRAINT `fk_{{prefix}}asset_favorites_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}asset_favorites_asset` FOREIGN KEY (`asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------------
-- Games, tokens
-- ---------------------------------------------------------------------------

-- games.world_map_id FK is added below, once maps exists (circular reference).
CREATE TABLE IF NOT EXISTS `{{prefix}}games` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `gm_user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `cover_asset_id` BIGINT UNSIGNED NULL,
  `world_map_id` BIGINT UNSIGNED NULL,
  `settings` JSON NOT NULL,
  `archived_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_gm_deleted` (`gm_user_id`, `deleted_at`),
  KEY `idx_cover_asset` (`cover_asset_id`),
  KEY `idx_world_map` (`world_map_id`),
  CONSTRAINT `fk_{{prefix}}games_gm_user` FOREIGN KEY (`gm_user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_{{prefix}}games_cover_asset` FOREIGN KEY (`cover_asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}game_members` (
  `game_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `joined_at` DATETIME NOT NULL,
  PRIMARY KEY (`game_id`, `user_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_{{prefix}}game_members_game` FOREIGN KEY (`game_id`)
    REFERENCES `{{prefix}}games` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}game_members_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `game_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `kind` VARCHAR(20) NOT NULL,
  `size_w` DECIMAL(4,2) NOT NULL DEFAULT 1,
  `size_h` DECIMAL(4,2) NOT NULL DEFAULT 1,
  `default_owner_user_id` BIGINT UNSIGNED NULL,
  `vision` JSON NOT NULL,
  `light` JSON NULL,
  `ring_color` VARCHAR(9) NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_game_deleted` (`game_id`, `deleted_at`),
  KEY `idx_asset` (`asset_id`),
  KEY `idx_default_owner` (`default_owner_user_id`),
  CONSTRAINT `fk_{{prefix}}tokens_game` FOREIGN KEY (`game_id`)
    REFERENCES `{{prefix}}games` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}tokens_asset` FOREIGN KEY (`asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_{{prefix}}tokens_default_owner_user` FOREIGN KEY (`default_owner_user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}encounters` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `game_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_game` (`game_id`),
  CONSTRAINT `fk_{{prefix}}encounters_game` FOREIGN KEY (`game_id`)
    REFERENCES `{{prefix}}games` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}encounter_tokens` (
  `encounter_id` BIGINT UNSIGNED NOT NULL,
  `token_id` BIGINT UNSIGNED NOT NULL,
  `dx` DECIMAL(7,3) NOT NULL,
  `dy` DECIMAL(7,3) NOT NULL,
  PRIMARY KEY (`encounter_id`, `token_id`),
  KEY `idx_token` (`token_id`),
  CONSTRAINT `fk_{{prefix}}encounter_tokens_encounter` FOREIGN KEY (`encounter_id`)
    REFERENCES `{{prefix}}encounters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}encounter_tokens_token` FOREIGN KEY (`token_id`)
    REFERENCES `{{prefix}}tokens` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------------
-- Maps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `{{prefix}}maps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `game_id` BIGINT UNSIGNED NULL,
  `owner_user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `folder` VARCHAR(191) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'battle',
  `grid_type` VARCHAR(20) NOT NULL DEFAULT 'square',
  `cell_px` SMALLINT UNSIGNED NOT NULL DEFAULT 70,
  `width_cells` SMALLINT UNSIGNED NOT NULL,
  `height_cells` SMALLINT UNSIGNED NOT NULL,
  `unit_label` VARCHAR(10) NOT NULL DEFAULT 'ft',
  `unit_per_cell` DECIMAL(6,2) NOT NULL DEFAULT 5,
  `theme` VARCHAR(30) NOT NULL DEFAULT 'parchment',
  `ambient` JSON NOT NULL,
  `palette` JSON NOT NULL,
  `layers` JSON NOT NULL,
  `generation` JSON NULL,
  `format_version` SMALLINT UNSIGNED NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `is_template` TINYINT(1) NOT NULL DEFAULT 0,
  `template_scope` VARCHAR(20) NULL,
  `thumb_asset_path` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_game_deleted_sort` (`game_id`, `deleted_at`, `sort_order`),
  KEY `idx_template` (`is_template`, `template_scope`),
  KEY `idx_owner` (`owner_user_id`),
  CONSTRAINT `fk_{{prefix}}maps_game` FOREIGN KEY (`game_id`)
    REFERENCES `{{prefix}}games` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}maps_owner_user` FOREIGN KEY (`owner_user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Circular reference games <-> maps. Replay-safe: the engine ignores a duplicate FK
-- (1826 on MySQL 8, 1005/1022 on MySQL 5.7 / MariaDB) when the constraint already exists.
ALTER TABLE `{{prefix}}games`
  ADD CONSTRAINT `fk_{{prefix}}games_world_map` FOREIGN KEY (`world_map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_floors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `map_id` BIGINT UNSIGNED NOT NULL,
  `level` SMALLINT NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_map_level` (`map_id`, `level`),
  CONSTRAINT `fk_{{prefix}}map_floors_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}party_positions` (
  `game_id` BIGINT UNSIGNED NOT NULL,
  `world_map_id` BIGINT UNSIGNED NOT NULL,
  `floor_id` BIGINT UNSIGNED NULL,
  `x` DECIMAL(9,3) NOT NULL,
  `y` DECIMAL(9,3) NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`game_id`, `world_map_id`),
  KEY `idx_world_map` (`world_map_id`),
  KEY `idx_floor` (`floor_id`),
  CONSTRAINT `fk_{{prefix}}party_positions_game` FOREIGN KEY (`game_id`)
    REFERENCES `{{prefix}}games` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}party_positions_world_map` FOREIGN KEY (`world_map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}party_positions_floor` FOREIGN KEY (`floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_chunks` (
  `map_id` BIGINT UNSIGNED NOT NULL,
  `floor_id` BIGINT UNSIGNED NOT NULL,
  `layer` VARCHAR(20) NOT NULL,
  `cx` SMALLINT UNSIGNED NOT NULL,
  `cy` SMALLINT UNSIGNED NOT NULL,
  `data` MEDIUMBLOB NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`map_id`, `floor_id`, `layer`, `cx`, `cy`),
  KEY `idx_floor` (`floor_id`),
  CONSTRAINT `fk_{{prefix}}map_chunks_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_chunks_floor` FOREIGN KEY (`floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Created before map_objects (map_objects.note_id references it).
CREATE TABLE IF NOT EXISTS `{{prefix}}map_notes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `map_id` BIGINT UNSIGNED NOT NULL,
  `uid` CHAR(21) NOT NULL,
  `title` VARCHAR(120) NOT NULL DEFAULT '',
  `body` MEDIUMTEXT NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `gm_only` TINYINT(1) NOT NULL DEFAULT 1,
  `read_aloud` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_map_uid` (`map_id`, `uid`),
  KEY `idx_asset` (`asset_id`),
  CONSTRAINT `fk_{{prefix}}map_notes_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_notes_asset` FOREIGN KEY (`asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_objects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` CHAR(21) NOT NULL,
  `map_id` BIGINT UNSIGNED NOT NULL,
  `floor_id` BIGINT UNSIGNED NOT NULL,
  `layer` VARCHAR(20) NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `geometry` JSON NOT NULL,
  `props` JSON NOT NULL,
  `note_id` BIGINT UNSIGNED NULL,
  `visibility` VARCHAR(30) NOT NULL DEFAULT 'all',
  `revealed_at` DATETIME NULL,
  `locked` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `bbox_x1` DECIMAL(9,3) NOT NULL,
  `bbox_y1` DECIMAL(9,3) NOT NULL,
  `bbox_x2` DECIMAL(9,3) NOT NULL,
  `bbox_y2` DECIMAL(9,3) NOT NULL,
  `rev` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_map_uid` (`map_id`, `uid`),
  KEY `idx_map_floor_type` (`map_id`, `floor_id`, `type`),
  KEY `idx_map_floor_bbox` (`map_id`, `floor_id`, `bbox_x1`, `bbox_y1`),
  KEY `idx_floor` (`floor_id`),
  KEY `idx_asset` (`asset_id`),
  KEY `idx_note` (`note_id`),
  CONSTRAINT `fk_{{prefix}}map_objects_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_objects_floor` FOREIGN KEY (`floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_objects_asset` FOREIGN KEY (`asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_{{prefix}}map_objects_note` FOREIGN KEY (`note_id`)
    REFERENCES `{{prefix}}map_notes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `from_map_id` BIGINT UNSIGNED NOT NULL,
  `from_object_id` BIGINT UNSIGNED NOT NULL,
  `to_map_id` BIGINT UNSIGNED NOT NULL,
  `to_floor_id` BIGINT UNSIGNED NULL,
  `to_x` DECIMAL(9,3) NULL,
  `to_y` DECIMAL(9,3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_from_map` (`from_map_id`),
  KEY `idx_from_object` (`from_object_id`),
  KEY `idx_to_map` (`to_map_id`),
  KEY `idx_to_floor` (`to_floor_id`),
  CONSTRAINT `fk_{{prefix}}map_links_from_map` FOREIGN KEY (`from_map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_links_from_object` FOREIGN KEY (`from_object_id`)
    REFERENCES `{{prefix}}map_objects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_links_to_map` FOREIGN KEY (`to_map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_links_to_floor` FOREIGN KEY (`to_floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` CHAR(21) NOT NULL,
  `map_id` BIGINT UNSIGNED NOT NULL,
  `floor_id` BIGINT UNSIGNED NOT NULL,
  `token_id` BIGINT UNSIGNED NOT NULL,
  `x` DECIMAL(9,3) NOT NULL,
  `y` DECIMAL(9,3) NOT NULL,
  `rotation` SMALLINT NOT NULL DEFAULT 0,
  `scale` DECIMAL(4,2) NOT NULL DEFAULT 1,
  `hidden` TINYINT(1) NOT NULL DEFAULT 0,
  `light_override` JSON NULL,
  `rev` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_map_uid` (`map_id`, `uid`),
  KEY `idx_map_floor` (`map_id`, `floor_id`),
  KEY `idx_floor` (`floor_id`),
  KEY `idx_token` (`token_id`),
  CONSTRAINT `fk_{{prefix}}map_tokens_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_tokens_floor` FOREIGN KEY (`floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_tokens_token` FOREIGN KEY (`token_id`)
    REFERENCES `{{prefix}}tokens` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_fog` (
  `map_id` BIGINT UNSIGNED NOT NULL,
  `floor_id` BIGINT UNSIGNED NOT NULL,
  `cx` SMALLINT UNSIGNED NOT NULL,
  `cy` SMALLINT UNSIGNED NOT NULL,
  `data` BLOB NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`map_id`, `floor_id`, `cx`, `cy`),
  KEY `idx_floor` (`floor_id`),
  CONSTRAINT `fk_{{prefix}}map_fog_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_fog_floor` FOREIGN KEY (`floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}map_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `map_id` BIGINT UNSIGNED NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `label` VARCHAR(120) NULL,
  `snapshot` LONGBLOB NOT NULL,
  `size_bytes` INT UNSIGNED NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_map_created` (`map_id`, `created_at`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_{{prefix}}map_versions_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_versions_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Maintained by the server on every map op.
CREATE TABLE IF NOT EXISTS `{{prefix}}map_asset_refs` (
  `map_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `ref_count` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`map_id`, `asset_id`),
  KEY `idx_asset` (`asset_id`),
  CONSTRAINT `fk_{{prefix}}map_asset_refs_map` FOREIGN KEY (`map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}map_asset_refs_asset` FOREIGN KEY (`asset_id`)
    REFERENCES `{{prefix}}assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------------
-- Play sessions and realtime
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `{{prefix}}play_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `game_id` BIGINT UNSIGNED NOT NULL,
  `code` CHAR(8) NOT NULL,
  `name` VARCHAR(120) NULL,
  `state` VARCHAR(20) NOT NULL DEFAULT 'lobby',
  `current_map_id` BIGINT UNSIGNED NULL,
  `current_floor_id` BIGINT UNSIGNED NULL,
  `camera` JSON NULL,
  `pause_screen` JSON NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `started_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_code` (`code`),
  KEY `idx_game_state` (`game_id`, `state`),
  KEY `idx_current_map` (`current_map_id`),
  KEY `idx_current_floor` (`current_floor_id`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_{{prefix}}play_sessions_game` FOREIGN KEY (`game_id`)
    REFERENCES `{{prefix}}games` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}play_sessions_current_map` FOREIGN KEY (`current_map_id`)
    REFERENCES `{{prefix}}maps` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_{{prefix}}play_sessions_current_floor` FOREIGN KEY (`current_floor_id`)
    REFERENCES `{{prefix}}map_floors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_{{prefix}}play_sessions_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}session_players` (
  `session_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `ready` TINYINT(1) NOT NULL DEFAULT 0,
  `joined_at` DATETIME NOT NULL,
  `last_seen_at` DATETIME NOT NULL,
  PRIMARY KEY (`session_id`, `user_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_{{prefix}}session_players_session` FOREIGN KEY (`session_id`)
    REFERENCES `{{prefix}}play_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}session_players_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}token_assignments` (
  `session_id` BIGINT UNSIGNED NOT NULL,
  `token_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`session_id`, `token_id`),
  KEY `idx_session_user` (`session_id`, `user_id`),
  KEY `idx_token` (`token_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_{{prefix}}token_assignments_session` FOREIGN KEY (`session_id`)
    REFERENCES `{{prefix}}play_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}token_assignments_token` FOREIGN KEY (`token_id`)
    REFERENCES `{{prefix}}tokens` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_{{prefix}}token_assignments_user` FOREIGN KEY (`user_id`)
    REFERENCES `{{prefix}}users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `{{prefix}}session_displays` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `pairing_code_hash` CHAR(64) NULL,
  `pairing_expires_at` DATETIME NULL,
  `device_token_hash` CHAR(64) NULL,
  `state` VARCHAR(20) NOT NULL,
  `settings` JSON NOT NULL,
  `last_ip` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `paired_at` DATETIME NULL,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_token_hash` (`device_token_hash`),
  KEY `idx_session` (`session_id`),
  CONSTRAINT `fk_{{prefix}}session_displays_session` FOREIGN KEY (`session_id`)
    REFERENCES `{{prefix}}play_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Event log per channel ('session:12', 'map:34'); no FK on purpose (purged by time / count).
CREATE TABLE IF NOT EXISTS `{{prefix}}events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel` VARCHAR(40) NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `audience` VARCHAR(20) NOT NULL,
  `audience_user_id` BIGINT UNSIGNED NULL,
  `payload` JSON NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `client_op_id` VARCHAR(40) NULL,
  `ephemeral` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_channel_id` (`channel`, `id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Idempotency of replayed writes (purged after 48 h).
CREATE TABLE IF NOT EXISTS `{{prefix}}processed_ops` (
  `client_op_id` VARCHAR(40) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `response` JSON NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`client_op_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
