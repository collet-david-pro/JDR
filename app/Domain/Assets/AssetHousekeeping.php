<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;

/**
 * Cron tasks of the asset domain (projet.md 6.5): storage/tmp older than 1 h, job files older
 * than 24 h, trash older than trash_days (rows and files).
 */
final class AssetHousekeeping
{
    public const TMP_MAX_AGE = 3600;
    public const JOB_FILES_MAX_AGE = 86400;
    public const TRASH_BATCH = 100;

    public function __construct(
        private AssetStorage $storage,
        private AssetRepository $assets,
        private Settings $settings,
        private Clock $clock,
    ) {
    }

    public function purgeTmp(): int
    {
        return $this->storage->purgeDir('tmp', self::TMP_MAX_AGE, $this->clock->timestamp());
    }

    public function purgeJobFiles(): int
    {
        return $this->storage->purgeDir('jobs', self::JOB_FILES_MAX_AGE, $this->clock->timestamp());
    }

    /**
     * Permanently deletes soft-deleted assets older than trash_days, files included
     * (their quota was given back at the soft delete).
     */
    public function purgeTrash(int $limit = self::TRASH_BATCH): int
    {
        $days = max(0, $this->settings->int('trash_days'));
        $before = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - $days * 86400);
        $count = 0;
        foreach ($this->assets->expiredTrash($before, $limit) as $asset) {
            $this->assets->hardDelete($asset->id);
            $this->storage->deleteFiles($asset->uuid, $asset->ext);
            $count++;
        }

        return $count;
    }
}
