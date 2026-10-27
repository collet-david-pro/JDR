<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Domain\Sessions\EventTypes;
use JDR\Realtime\Audience;
use JDR\Realtime\Channel;
use JDR\Realtime\EventStore;

/**
 * display.* events (contract P7a), recorded in the transaction of the change on the channel of
 * the session. Screens only get the trimmed object (DisplayPresenter::forDisplays).
 */
final class DisplayEvents
{
    public function __construct(private EventStore $store, private DisplayPresenter $presenter)
    {
    }

    /** display.paired (gm). */
    public function paired(Display $d): void
    {
        $this->record($d->sessionId, EventTypes::DISPLAY_PAIRED, Audience::GM, ['display' => $this->presenter->withoutPairing($d)], null);
    }

    /** display.updated (gm, plus displays unless $gmOnly). */
    public function updated(Display $d, ?int $actor, bool $gmOnly = false): void
    {
        $this->record($d->sessionId, EventTypes::DISPLAY_UPDATED, Audience::GM, ['display' => $this->presenter->withoutPairing($d)], $actor);
        if (!$gmOnly) {
            $this->record($d->sessionId, EventTypes::DISPLAY_UPDATED, Audience::DISPLAYS, ['display' => $this->presenter->forDisplays($d)], $actor);
        }
    }

    /** display.revoked (gm and displays). */
    public function revoked(Display $d, ?int $actor): void
    {
        foreach ([Audience::GM, Audience::DISPLAYS] as $audience) {
            $this->record($d->sessionId, EventTypes::DISPLAY_REVOKED, $audience, ['display_id' => $d->id], $actor);
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function record(int $sessionId, string $type, string $audience, array $payload, ?int $actor): void
    {
        $this->store->record(Channel::session($sessionId), $type, $audience, $payload, null, $actor);
    }
}
