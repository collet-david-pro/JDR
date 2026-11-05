<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;

/**
 * Floors of a map seen by their reference (P9a1): a floor is designated by its numeric id (legacy)
 * or by its uid ("f1", client generated, [A-Za-z0-9_-]{1,21}, never all digits).
 * Reads are cached for the life of the request (one instance per request); call forget() after a
 * write on the floors of a map.
 */
final class MapFloors
{
    public const UID_PATTERN = '/^[A-Za-z0-9_-]{1,21}$/D';
    public const MAX_FLOORS = 10;
    public const LEVEL_MIN = -9;
    public const LEVEL_MAX = 9;

    /** @var array<int, list<array{id: int, uid: string, level: int, name: string, sort_order: int}>> */
    private array $cache = [];

    public function __construct(private MapRepository $maps)
    {
    }

    /**
     * A floor reference: numeric id (int or digits) or uid; null = neither.
     */
    public static function ref(mixed $value): int|string|null
    {
        $id = Fields::id($value);
        if ($id !== null) {
            return $id;
        }

        return self::isUid($value) ? $value : null;
    }

    /**
     * A well-formed uid (not entirely numeric: that would be an id).
     */
    public static function isUid(mixed $value): bool
    {
        return is_string($value) && preg_match(self::UID_PATTERN, $value) === 1 && !ctype_digit($value);
    }

    /**
     * Floors in display order.
     *
     * @return list<array{id: int, uid: string, level: int, name: string, sort_order: int}>
     */
    public function list(int $mapId): array
    {
        return $this->cache[$mapId] ??= $this->maps->floors($mapId);
    }

    /**
     * Drops the cached floor list of the map.
     */
    public function forget(int $mapId): void
    {
        unset($this->cache[$mapId]);
    }

    /**
     * Floor id of a reference, null when the map has no such floor.
     */
    public function resolve(int $mapId, int|string $ref): ?int
    {
        foreach ($this->list($mapId) as $floor) {
            if (is_int($ref) ? $floor['id'] === $ref : $floor['uid'] === $ref) {
                return $floor['id'];
            }
        }

        return null;
    }

    /**
     * Returns the uid of a floor, or null when the map has no such floor.
     */
    public function uidOf(int $mapId, int $floorId): ?string
    {
        foreach ($this->list($mapId) as $floor) {
            if ($floor['id'] === $floorId) {
                return $floor['uid'];
            }
        }

        return null;
    }

    /**
     * The uid given to the n-th floor (0-based) of a created / migrated map.
     */
    public static function defaultUid(int $position): string
    {
        return 'f' . ($position + 1);
    }
}
