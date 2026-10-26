<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;

/**
 * Cron tasks of the sessions (projet.md 6.5, etapes P06 D2 / D6): "sessions" deletes the sessions
 * ended for more than 90 days (players, assignments and screens follow by FK CASCADE);
 * "presence" disconnects the players unseen for more than 60 s (PresenceService::sweep).
 */
final class SessionHousekeeping
{
    public const RETENTION_DAYS = 90;
    public const BATCH = 200;

    public function __construct(
        private SessionRepository $sessions,
        private PresenceService $presence,
        private Clock $clock,
    ) {
    }

    public function purgeEnded(int $limit = self::BATCH): int
    {
        $before = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - self::RETENTION_DAYS * 86400);

        return $this->sessions->purgeEnded($before, $limit);
    }

    public function sweepPresence(): int
    {
        return $this->presence->sweep();
    }
}
