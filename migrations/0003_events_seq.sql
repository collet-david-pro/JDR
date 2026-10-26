-- @idempotent-ddl
-- 0003_events_seq: ordering lock and purge mark of the event log (etapes P06, decisions D1-D2).
-- Compatible MySQL 5.7+ / MariaDB 10.3+. Replayable: CREATE TABLE IF NOT EXISTS + INSERT IGNORE.
--
-- One row (id = 1). JDR\Realtime\EventStore locks it (SELECT ... FOR UPDATE) right before
-- inserting the events of a transaction and keeps the lock until COMMIT: event ids therefore
-- become visible in increasing order and a reader asking "id > since" never skips one.
-- purged_upto = highest non-ephemeral event id removed by the purge: since < purged_upto
-- => 410 events_gone (the client reloads the snapshot).
-- The reads (channel, id) use the index idx_channel_id created by 0001_initial; the purge uses
-- idx_created and the primary key.
CREATE TABLE IF NOT EXISTS `{{prefix}}event_seq` (
  `id` TINYINT UNSIGNED NOT NULL,
  `purged_upto` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

INSERT IGNORE INTO `{{prefix}}event_seq` (`id`, `purged_upto`) VALUES (1, 0);
