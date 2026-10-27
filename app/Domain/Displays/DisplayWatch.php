<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Domain\Sessions\SessionRepository;
use JDR\Domain\Support\Dates;
use JDR\Realtime\Every;
use JDR\Realtime\LoopListener;
use JDR\Realtime\Subscription;

/**
 * Revalidation of a projection screen during its real-time reads (etapes P07b D7): every 5 s the
 * row of the screen is read again; deleted (revoked, unpaired), no longer active, moved to another
 * session, or its session ended => the subscription is closed (the SSE / long-polling loop ends at
 * its next iteration; the reconnection gets 401 display_unpaired, 404 or 409). last_seen_at,
 * last_ip and user_agent are written at most every 20 s (DisplayDevice::TOUCH_SECONDS).
 * Never throws for a missing row: it closes.
 */
final class DisplayWatch implements LoopListener
{
    public const CHECK_S = 5;

    /** @var \WeakMap<Subscription, Every> */
    private \WeakMap $checks;

    public function __construct(
        private DisplayRepository $displays,
        private SessionRepository $sessions,
        private Clock $clock,
    ) {
        $this->checks = new \WeakMap();
    }

    public function onLoopTick(Subscription $sub, float $now): void
    {
        if ($sub->displayId === null || $sub->isClosed()) {
            return;
        }
        $every = $this->checks[$sub] ??= new Every(self::CHECK_S);
        if (!$every->due($now)) {
            return;
        }
        $display = $this->displays->find($sub->displayId);
        $sessionIds = array_map(static fn ($g): int => $g->targetId, array_values($sub->grants));
        $session = $display === null ? null : $this->sessions->find($display->sessionId);
        if ($display === null || !$display->isActive() || !in_array($display->sessionId, $sessionIds, true)
            || $session === null || $session->isEnded()) {
            $sub->close();

            return;
        }
        $seen = Dates::timestamp($display->lastSeenAt);
        if ($seen === null || $this->clock->timestamp() - $seen >= DisplayDevice::TOUCH_SECONDS) {
            $this->displays->update($display->id, [
                'last_seen_at' => $this->clock->sql(),
                'last_ip' => $sub->clientIp ?? $display->lastIp,
                'user_agent' => $sub->userAgent ?? $display->userAgent,
            ]);
        }
    }
}
