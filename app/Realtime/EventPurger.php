<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Domain\Settings\Settings;

/**
 * Cron task "events" (etapes P06 D2, projet.md 6.5 and 22):
 * - non-ephemeral events older than events_retention_hours (24 h): event_seq.purged_upto is
 *   raised to the highest of their ids FIRST (committed), then every non-ephemeral event up to
 *   that id is deleted. A reader therefore never misses a purged event silently: either the
 *   event is still there or the mark already says 410 events_gone;
 * - ephemeral events (cursors…) older than 2 min: deleted without moving the mark (losing one
 *   is harmless by definition, and a short disconnection must not force a snapshot reload).
 * Deletions go by batches of 5000 (short locks).
 */
final class EventPurger
{
    public const EPHEMERAL_SECONDS = 120;
    public const BATCH = 5000;
    private const DEFAULT_HOURS = 24;

    public function __construct(private Db $db, private Clock $clock, private Settings $settings)
    {
    }

    /**
     * @return int number of events deleted
     */
    public function purge(): int
    {
        $hours = $this->settings->int('events_retention_hours');
        $now = $this->clock->timestamp();

        return $this->purgeDurable(gmdate('Y-m-d H:i:s', $now - 3600 * ($hours > 0 ? $hours : self::DEFAULT_HOURS)))
            + $this->purgeEphemeral(gmdate('Y-m-d H:i:s', $now - self::EPHEMERAL_SECONDS));
    }

    public function purgedUpto(): int
    {
        return (int) $this->db->fetchValue('SELECT `purged_upto` FROM ' . $this->db->t('event_seq') . ' WHERE `id` = 1');
    }

    private function purgeDurable(string $cutoff): int
    {
        $events = $this->db->t('events');
        $upto = $this->db->fetchValue(
            'SELECT MAX(`id`) FROM ' . $events . ' WHERE `ephemeral` = 0 AND `created_at` < ?',
            [$cutoff],
        );
        if ($upto === null) {
            return 0;
        }
        $upto = (int) $upto;
        $this->db->execute(
            'UPDATE ' . $this->db->t('event_seq') . ' SET `purged_upto` = GREATEST(`purged_upto`, ?) WHERE `id` = 1',
            [$upto],
        );

        return $this->deleteBatches('`ephemeral` = 0 AND `id` <= ?', [$upto]);
    }

    private function purgeEphemeral(string $cutoff): int
    {
        return $this->deleteBatches('`ephemeral` = 1 AND `created_at` < ?', [$cutoff]);
    }

    /**
     * @param list<int|string> $params
     */
    private function deleteBatches(string $where, array $params): int
    {
        $total = 0;
        do {
            $n = $this->db->execute(
                'DELETE FROM ' . $this->db->t('events') . ' WHERE ' . $where . ' ORDER BY `id` LIMIT ' . self::BATCH,
                $params,
            );
            $total += $n;
        } while ($n === self::BATCH);

        return $total;
    }
}
