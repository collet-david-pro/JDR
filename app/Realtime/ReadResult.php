<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Result of EventReader::read(): the visible events (id order) and the cursor to send back as
 * `since` next time. lastId may be past the last visible event (events of another audience
 * are skipped, never re-read). more = the 500 limit was reached (read again right away).
 */
final class ReadResult
{
    /**
     * @param list<WireEvent> $events
     */
    public function __construct(public readonly array $events, public readonly int $lastId, public readonly bool $more)
    {
    }

    /**
     * @return array{events: list<array<string, mixed>>, last_id: string}
     */
    public function toArray(): array
    {
        return [
            'events' => array_map(static fn (WireEvent $e): array => $e->toArray(), $this->events),
            'last_id' => (string) $this->lastId,
        ];
    }
}
