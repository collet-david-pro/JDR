<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Right of a reader on one channel: its role there (Audience::ROLE_*), for the audience filter.
 */
final class ChannelGrant
{
    public function __construct(
        public readonly string $channel,
        public readonly string $kind,
        public readonly int $targetId,
        public readonly int $gameId,
        public readonly string $role,
    ) {
    }
}
