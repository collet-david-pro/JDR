<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Maps\MapState;
use JDR\Maps\ObjectRules;

/**
 * Applies the note ops of a lot (MapNoteInput) to a locked map, for OpsApplier, in the lot order:
 * - note.add: ops.<i>.note.uid = taken (ignoring case, like the unique key), ops.<i> = limit past
 *   500 notes, asset_id = not_found (same canUse as the other ops), audience_users = not_member;
 * - note.update: an unknown uid is a conflict {kind: note, reason: gone}; "players" needs accounts
 *   (given by the patch, or already stored): ops.<i>.patch.audience_users = required;
 * - note.remove: idempotent; the objects linked to the note pass to props.note = null, rev + 1
 *   (at the end of the lot: an object may be changed by a later op of the lot; a note added
 *   again in the lot keeps its objects);
 * - secrets.reset: revealed_at = NULL on the traps and secrets of the map.
 * It also watches the object ops of the lot: props.note must be a note of the map, at this point
 * of the lot (not_found), and map_objects.note_id follows props.note. The images of the notes count
 * in map_asset_refs (one per note).
 */
final class MapNotesOps
{
    /** @var array<string, int>|null stored uid => note id */
    private ?array $known = null;
    /** @var array<string, string> object uid => uid of the note removed */
    private array $unlink = [];
    /** @var array<int, int> asset id => delta */
    private array $refs = [];
    /** @var list<array<string, mixed>> */
    private array $conflicts = [];

    /**
     * @param \Closure(int): bool $canUseAsset may the editor put this asset on the map
     */
    public function __construct(
        private MapNotes $notes,
        private MapRepository $maps,
        private MapSceneRepository $scene,
        private MapState $state,
        private int $mapId,
        private int $gameId,
        private \Closure $canUseAsset,
    ) {
    }

    /**
     * @param array<string, mixed> $op
     * @return bool applied
     * @throws ValidationException
     */
    public function apply(array $op, int $index): bool
    {
        $field = 'ops.' . $index;

        return match ($op['type']) {
            'note.add' => $this->add($op['note'], $field),
            'note.update' => $this->update($op, $field, $index),
            'note.remove' => $this->remove($op['uid']),
            default => $this->notes->resetSecrets($this->mapId) > 0,
        };
    }

    /**
     * Before an object op is applied: its props.note must exist now.
     *
     * @param array<string, mixed> $op
     * @throws ValidationException
     */
    public function beforeObjectOp(array $op, string $field): void
    {
        [$note, $f] = match ($op['type']) {
            'object.add' => [$op['object']['props']['note'] ?? null, $field . '.object.props.note'],
            'object.update' => [is_array($op['patch']['props'] ?? null) ? ($op['patch']['props']['note'] ?? null) : null, $field . '.patch.props.note'],
            default => [null, ''],
        };
        if (is_string($note) && !isset($this->known()[$note])) {
            throw new ValidationException('', [$f => 'not_found']);
        }
    }

    /**
     * After an object op was applied: note_id follows props.note.
     *
     * @param array<string, mixed> $op
     */
    public function afterObjectOp(array $op): void
    {
        if ($op['type'] === 'object.add') {
            $props = $op['object']['props'];
            $uid = $op['object']['uid'];
        } elseif ($op['type'] === 'object.update' && is_array($op['patch']['props'] ?? null)) {
            $props = $op['patch']['props'];
            $uid = $op['uid'];
        } else {
            return;
        }
        if (is_string($props['note'] ?? null)) {
            $this->notes->linkObject($this->mapId, $uid, $this->known()[$props['note']] ?? null);
        } elseif ($op['type'] === 'object.update') {
            // Omitted props.note means null; a type without note has nothing linked.
            $this->notes->linkObject($this->mapId, $uid, null);
        }
        unset($this->unlink[$uid]);
    }

    /**
     * End of the lot: objects of the removed notes, asset references.
     */
    public function flush(): void
    {
        if ($this->unlink !== []) {
            foreach ($this->scene->objectsByUid($this->mapId, array_keys($this->unlink)) as $row) {
                $object = $row['object'];
                $removed = $this->unlink[(string) $object['uid']] ?? null;
                if ($removed === null || ($object['props']['note'] ?? null) !== $removed) {
                    continue;
                }
                if (isset($this->known()[$removed])) {
                    $this->notes->linkObject($this->mapId, (string) $object['uid'], $this->known()[$removed]);
                    continue;
                }
                $object['props']['note'] = null;
                $object['rev']++;
                $object = ObjectRules::canonical($object);
                $this->scene->updateObject($row['id'], $object, ObjectRules::bbox($object, $this->state->width, $this->state->height));
            }
            $this->unlink = [];
        }
        $this->maps->applyRefDeltas($this->mapId, $this->refs);
        $this->refs = [];
    }

    /**
     * @return list<array<string, mixed>> {op_index, kind: note, uid, reason, current: null}
     */
    public function conflicts(): array
    {
        return $this->conflicts;
    }

    /**
     * @param array<string, mixed> $note
     */
    private function add(array $note, string $field): bool
    {
        $f = $field . '.note';
        foreach (array_keys($this->known()) as $uid) {
            if (strcasecmp((string) $uid, $note['uid']) === 0) {
                throw new ValidationException('', [$f . '.uid' => 'taken']);
            }
        }
        if (count($this->known()) >= MapNoteInput::MAX_NOTES) {
            throw new ValidationException('', [$field => 'limit']);
        }
        $this->requireAsset($note['asset_id'], $f);
        $this->requireMembers($note['audience_users'], $f);
        $this->known[$note['uid']] = $this->notes->insert($this->mapId, $note);
        $this->countRef($note['asset_id'], 1);

        return true;
    }

    /**
     * @param array<string, mixed> $op
     */
    private function update(array $op, string $field, int $index): bool
    {
        $row = $this->notes->byUids($this->mapId, [$op['uid']])[$op['uid']] ?? null;
        if ($row === null) {
            $this->conflicts[] = ['op_index' => $index, 'kind' => 'note', 'uid' => $op['uid'], 'reason' => 'gone', 'current' => null];

            return false;
        }
        $patch = $op['patch'];
        $f = $field . '.patch';
        $audience = $patch['audience'] ?? $row['audience'];
        $users = $audience === MapNoteInput::AUDIENCE_PLAYERS ? ($patch['audience_users'] ?? $row['users']) : [];
        if ($audience === MapNoteInput::AUDIENCE_PLAYERS && $users === []) {
            throw new ValidationException('', [$f . '.audience_users' => 'required']);
        }
        if ($users !== $row['users']) {
            $this->requireMembers($users, $f);
        }
        $asset = array_key_exists('asset_id', $patch) ? $patch['asset_id'] : $row['asset_id'];
        if ($asset !== $row['asset_id']) {
            $this->requireAsset($asset, $f);
            $this->countRef($row['asset_id'], -1);
            $this->countRef($asset, 1);
        }
        $this->notes->update($row['id'], [
            'title' => $patch['title'] ?? $row['title'],
            'body' => $patch['body'] ?? $row['body'],
            'asset_id' => $asset,
            'audience' => $audience,
            'users' => $users,
            'read_aloud' => $patch['read_aloud'] ?? $row['read_aloud'],
        ]);

        return true;
    }

    private function remove(string $uid): bool
    {
        $row = $this->notes->byUids($this->mapId, [$uid])[$uid] ?? null;
        if ($row === null) {
            return false;
        }
        foreach ($this->notes->linkedObjectUids($this->mapId, [$row['id']]) as $objectUid) {
            $this->unlink[$objectUid] = $uid;
        }
        $this->notes->delete($row['id']);
        unset($this->known[$uid]);
        $this->countRef($row['asset_id'], -1);

        return true;
    }

    /**
     * @return array<string, int>
     */
    private function known(): array
    {
        return $this->known ??= $this->notes->uids($this->mapId);
    }

    private function requireAsset(?int $assetId, string $field): void
    {
        if ($assetId !== null && !($this->canUseAsset)($assetId)) {
            throw new ValidationException('', [$field . '.asset_id' => 'not_found']);
        }
    }

    /**
     * @param list<int> $users
     */
    private function requireMembers(array $users, string $field): void
    {
        if (array_diff($users, array_keys($this->notes->members($this->gameId, $users))) !== []) {
            throw new ValidationException('', [$field . '.audience_users' => 'not_member']);
        }
    }

    private function countRef(?int $assetId, int $delta): void
    {
        if ($assetId !== null) {
            $this->refs[$assetId] = ($this->refs[$assetId] ?? 0) + $delta;
        }
    }
}
