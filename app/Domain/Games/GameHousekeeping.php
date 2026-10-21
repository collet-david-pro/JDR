<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Tokens\TokenRepository;

/**
 * Cron task "games_trash" (projet.md 6.5): games in the trash for more than trash_days are
 * permanently deleted (members, tokens, encounters, maps, sessions follow by FK CASCADE),
 * and so are the soft-deleted tokens older than trash_days.
 */
final class GameHousekeeping
{
    public const BATCH = 50;

    public function __construct(
        private GameRepository $games,
        private TokenRepository $tokens,
        private Settings $settings,
        private Clock $clock,
    ) {
    }

    public function purgeTrash(int $limit = self::BATCH): int
    {
        $days = max(0, $this->settings->int('trash_days'));
        $before = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - $days * 86400);
        $count = 0;
        foreach ($this->games->expiredTrash($before, $limit) as $gameId) {
            $this->games->hardDelete($gameId);
            $count++;
        }

        return $count + $this->tokens->purgeDeleted($before, $limit * 10);
    }
}
