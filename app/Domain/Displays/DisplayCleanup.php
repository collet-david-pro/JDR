<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

/**
 * Revokes every screen of a session when it ends (P7g): display.revoked then deletion, like
 * DisplayService::revoke. Must be called inside the transaction of the end of the session.
 */
final class DisplayCleanup
{
    public function __construct(
        private DisplayRepository $displays,
        private DisplayEvents $events,
    ) {
    }

    /**
     * @return int number of screens revoked
     */
    public function revokeAllOf(int $sessionId, ?int $actorId): int
    {
        $all = $this->displays->listForSession($sessionId);
        foreach ($all as $display) {
            $this->events->revoked($display, $actorId);
            $this->displays->delete($display->id);
        }

        return count($all);
    }
}
