<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\MapFloors;

/**
 * Applies the floor ops of a lot (P9a1, D1) to the MapState, in the lot order:
 * - floor.add: uid / level unused ("taken"), 10 floors at most ("limit");
 * - floor.update: unknown uid "not_found", level used by another floor "taken";
 * - floor.remove: unknown uid "not_found", the last floor "last_floor". The floor and ALL its
 *   content go (the client reads the content before to be able to undo with floor.add + content).
 * After each op the floors are numbered by level (sort_order = rank), the state is refreshed and
 * floorsChanged is set. Sessions standing on a removed floor move to the first remaining one
 * (movedSessions()).
 */
final class FloorApplier
{
    /** @var list<array{session_id: int, floor_id: int}> */
    private array $moved = [];

    public function __construct(private MapState $state, private FloorStore $store)
    {
    }

    /**
     * @param array<string, mixed> $op normalized by MapFloorOpsInput
     * @throws ValidationException
     */
    public function apply(array $op, string $field): ?int
    {
        return match ($op['type']) {
            'floor.add' => $this->add($op['floor'], $field),
            'floor.update' => $this->update($op, $field),
            default => $this->remove($op['uid'], $field),
        };
    }

    /**
     * @return list<array{session_id: int, floor_id: int}>
     */
    public function movedSessions(): array
    {
        return $this->moved;
    }

    /**
     * @param array{uid: string, name: string, level: int} $floor
     */
    private function add(array $floor, string $field): ?int
    {
        if (count($this->state->floors) >= MapFloors::MAX_FLOORS) {
            throw new ValidationException('', [$field . '.floor' => 'limit']);
        }
        $errors = [];
        if ($this->byUid($floor['uid']) !== null) {
            $errors[$field . '.floor.uid'] = 'taken';
        }
        if ($this->byLevel($floor['level']) !== null) {
            $errors[$field . '.floor.level'] = 'taken';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $id = $this->store->insert($floor['uid'], $floor['level'], $floor['name'], $floor['level']);
        $floors = $this->state->floors;
        $floors[] = ['id' => $id, 'uid' => $floor['uid'], 'level' => $floor['level'], 'name' => $floor['name'], 'sort_order' => $floor['level']];
        $this->renumber($floors);

        return null;
    }

    /**
     * @param array<string, mixed> $op
     */
    private function update(array $op, string $field): ?int
    {
        $current = $this->byUid($op['uid']) ?? throw new ValidationException('', [$field . '.uid' => 'not_found']);
        $patch = $op['patch'];
        if (isset($patch['level'])) {
            $other = $this->byLevel($patch['level']);
            if ($other !== null && $other['id'] !== $current['id']) {
                throw new ValidationException('', [$field . '.patch.level' => 'taken']);
            }
        }
        $fields = array_intersect_key($patch, ['name' => true, 'level' => true]);
        $fields = array_filter($fields, static fn (mixed $v, string $k): bool => $v !== $current[$k], ARRAY_FILTER_USE_BOTH);
        if ($fields !== []) {
            $this->store->update($current['id'], $fields);
            $floors = array_map(static fn (array $f): array => $f['id'] === $current['id'] ? $fields + $f : $f, $this->state->floors);
            $this->renumber($floors);
        }

        return null;
    }

    private function remove(string $uid, string $field): ?int
    {
        $current = $this->byUid($uid) ?? throw new ValidationException('', [$field . '.uid' => 'not_found']);
        $rest = array_values(array_filter($this->state->floors, static fn (array $f): bool => $f['id'] !== $current['id']));
        if ($rest === []) {
            throw new ValidationException('', [$field . '.uid' => 'last_floor']);
        }
        foreach ($this->store->remove($current['id'], $rest[0]['id']) as $sessionId) {
            $this->moved[] = ['session_id' => $sessionId, 'floor_id' => $rest[0]['id']];
        }
        $this->renumber($rest);

        return $current['id'];
    }

    /**
     * Floors sorted by level, sort_order = rank (written when it changes), state refreshed.
     *
     * @param list<array{id: int, uid: string, level: int, name: string, sort_order: int}> $floors
     */
    private function renumber(array $floors): void
    {
        usort($floors, static fn (array $a, array $b): int => $a['level'] <=> $b['level']);
        $before = array_column($this->state->floors, 'sort_order', 'id');
        foreach ($floors as $rank => $floor) {
            $floors[$rank]['sort_order'] = $rank;
            if (($before[$floor['id']] ?? null) !== $rank) {
                $this->store->update($floor['id'], ['sort_order' => $rank]);
            }
        }
        $this->state->setFloors($floors);
        $this->state->floorsChanged = true;
    }

    /**
     * @return array{id: int, uid: string, level: int, name: string, sort_order: int}|null
     */
    private function byUid(string $uid): ?array
    {
        foreach ($this->state->floors as $f) {
            if ($f['uid'] === $uid) {
                return $f;
            }
        }

        return null;
    }

    /**
     * @return array{id: int, uid: string, level: int, name: string, sort_order: int}|null
     */
    private function byLevel(int $level): ?array
    {
        foreach ($this->state->floors as $f) {
            if ($f['level'] === $level) {
                return $f;
            }
        }

        return null;
    }
}
