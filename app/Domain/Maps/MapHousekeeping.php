<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;

/**
 * Cron tasks (projet.md 6.5): "maps_trash" permanently deletes the maps in the trash for more
 * than trash_days (floors, chunks, refs... by FK CASCADE); "processed_ops" forgets the
 * idempotence records older than 48 h (7.2).
 */
final class MapHousekeeping
{
    public const BATCH = 50;
    public const PROCESSED_OPS_HOURS = 48;
    public const PROCESSED_OPS_BATCH = 5000;

    public function __construct(private MapRepository $maps, private Settings $settings, private Clock $clock)
    {
    }

    public function purgeTrash(int $limit = self::BATCH): int
    {
        $days = max(0, $this->settings->int('trash_days'));
        $before = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - $days * 86400);
        $count = 0;
        foreach ($this->maps->expiredTrash($before, $limit) as $mapId) {
            $this->maps->hardDelete($mapId);
            $count++;
        }

        return $count;
    }

    public function purgeProcessedOps(int $limit = self::PROCESSED_OPS_BATCH): int
    {
        $before = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - self::PROCESSED_OPS_HOURS * 3600);

        return $this->maps->purgeProcessed($before, $limit);
    }
}
