<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapNotes;
use JDR\Domain\Maps\MapSceneRepository;

/**
 * What a change of notes means for each recipient of a session (etapes P09 D3, D4), written
 * through FanoutBatch, always recipient by recipient (never the audience "players"):
 * - note.shared {note: recipient form}: he gains the note, or its contents changed;
 * - note.hidden {uid}: he loses it (hidden again, or removed);
 * - map.ops.public {objects: {upsert, remove}}: the objects linked to these notes as he now sees
 *   them (a pin appears or disappears, props.note becomes the uid or null);
 * - the traps and secrets hidden again by secrets.reset (FanoutBatch::unreveal).
 * capture() runs before the change, emit() after it. The GM versions are written by the callers
 * (map.ops for the ops, note.shared for the action note.share).
 */
final class NoteFanout
{
    public function __construct(private MapNotes $notes, private MapSceneRepository $scene)
    {
    }

    /**
     * State before the note ops of a lot; null when the lot has none (no cost for the others).
     *
     * @param list<array<string, mixed>> $ops normalized
     * @return array<string, mixed>|null
     */
    public function prepare(Map $map, array $ops): ?array
    {
        $uids = [];
        $reset = false;
        foreach ($ops as $op) {
            match ($op['type']) {
                'note.add' => $uids[] = $op['note']['uid'],
                'note.update', 'note.remove' => $uids[] = $op['uid'],
                'secrets.reset' => $reset = true,
                default => null,
            };
        }

        return $uids === [] && !$reset ? null : $this->capture($map, $uids, $reset);
    }

    /**
     * @param list<string> $uids notes about to change
     * @return array<string, mixed>
     */
    public function capture(Map $map, array $uids, bool $reset = false): array
    {
        $rows = $this->notes->byUids($map->id, $uids);
        $linked = $this->notes->linkedObjectUids($map->id, array_column($rows, 'id'));

        return [
            'map_id' => $map->id,
            'uids' => $uids,
            'notes' => $rows,
            'visibility' => $this->notes->visibility($map->id),
            'objects' => $this->objects($map->id, $linked),
            'revealed' => $reset ? array_values($this->objects($map->id, $this->notes->revealedSecretUids($map->id))) : [],
        ];
    }

    /**
     * Writes the versions of each recipient of each batch after the change.
     *
     * @param array<string, mixed> $capture capture()
     * @param list<FanoutBatch>    $batches
     */
    public function emit(array $capture, array $batches, ?int $revision = null): void
    {
        $mapId = (int) $capture['map_id'];
        $after = $this->notes->visibility($mapId);
        $rows = $this->notes->byUids($mapId, $capture['uids']);
        $objectsAfter = $this->objects($mapId, array_keys($capture['objects']));
        $pairs = [];
        foreach ($capture['objects'] as $uid => $before) {
            $pairs[] = [$before, $objectsAfter[$uid] ?? null];
        }
        foreach ($batches as $batch) {
            if ($revision !== null) {
                $batch->setRevision($revision);
            }
            $batch->setNotes($after);
            if ($capture['revealed'] !== []) {
                $batch->unreveal($capture['revealed']);
            }
            $this->recipients($batch, $capture['visibility'], $after, $capture['notes'], $rows, $capture['uids'], $pairs);
        }
    }

    /**
     * @param array<string, array<string, mixed>> $before notes before, by uid
     * @param array<string, array<string, mixed>> $now    notes after, by uid
     * @param list<string>                        $uids
     * @param list<array{0: array<string, mixed>, 1: array<string, mixed>|null}> $pairs objects [before, after]
     */
    private function recipients(FanoutBatch $batch, NoteVisibility $was, NoteVisibility $is, array $before, array $now, array $uids, array $pairs): void
    {
        $batch->eachRecipient(static function (PlayerSight $sight, int $user, FogScope $scope) use ($batch, $was, $is, $before, $now, $uids, $pairs): array {
            $events = [];
            foreach (array_unique($uids) as $uid) {
                $had = isset($before[$uid]) && $was->visibleTo($uid, $user);
                $has = isset($now[$uid]) && $is->visibleTo($uid, $user);
                if ($has && (!$had || MapNotes::recipientForm($before[$uid]) !== MapNotes::recipientForm($now[$uid]))) {
                    $events[] = [EventTypes::NOTE_SHARED, ['note' => MapNotes::recipientForm($now[$uid])]];
                } elseif ($had && !$has) {
                    $events[] = [EventTypes::NOTE_HIDDEN, ['uid' => $uid]];
                }
            }
            $upsert = [];
            $remove = [];
            foreach ($pairs as [$objectBefore, $objectAfter]) {
                $vb = $sight->object($objectBefore, $scope, null, $user, $was);
                $va = $objectAfter === null ? null : $sight->object($objectAfter, $scope, null, $user, $is);
                if ($va !== null && $va !== $vb) {
                    $upsert[] = $va;
                } elseif ($va === null && $vb !== null) {
                    $remove[] = (string) $vb['uid'];
                }
            }
            if ($upsert !== [] || $remove !== []) {
                $events[] = $batch->opsEvent($upsert, $remove);
            }

            return $events;
        });
    }

    /**
     * @param list<string> $uids
     * @return array<string, array<string, mixed>> exact uid => object (API form)
     */
    private function objects(int $mapId, array $uids): array
    {
        $out = [];
        foreach ($uids === [] ? [] : $this->scene->objectsByUid($mapId, $uids) as $row) {
            $out[(string) $row['object']['uid']] = $row['object'];
        }

        return $out;
    }
}
