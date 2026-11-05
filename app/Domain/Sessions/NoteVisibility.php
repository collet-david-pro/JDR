<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * Who sees the notes of a map (etapes P09 D3), without their contents: a note is visible to a
 * recipient when its audience is "all", or "players" and his id is listed. The table of the
 * projection screens (TableView::USER = 0, no account has this id) only sees "all". A GM / co-GM
 * sees every note and never goes through this class. A note absent from the list is seen by
 * nobody (audience gm): refusal by default.
 */
final class NoteVisibility
{
    /**
     * @param array<string, array{audience: string, users: array<int, true>}> $notes shared notes: exact uid =>
     */
    public function __construct(private array $notes = [])
    {
    }

    /**
     * Tells whether the viewer may see the note with this uid.
     */
    public function visibleTo(string $uid, int $viewer): bool
    {
        $note = $this->notes[$uid] ?? null;
        if ($note === null) {
            return false;
        }

        return $note['audience'] === 'all' || ($note['audience'] === 'players' && isset($note['users'][$viewer]));
    }

    /**
     * Uids of the notes $viewer sees.
     *
     * @return list<string>
     */
    public function uidsFor(int $viewer): array
    {
        $out = [];
        foreach (array_keys($this->notes) as $uid) {
            if ($this->visibleTo((string) $uid, $viewer)) {
                $out[] = (string) $uid;
            }
        }

        return $out;
    }
}
