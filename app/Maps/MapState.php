<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Mutable state of a map while a lot of ops is applied (OpsApplier). $changed lists the maps
 * columns to write back (name, cell_px, width_cells, height_cells, unit_label, unit_per_cell,
 * theme, ambient, palette, layers).
 */
final class MapState
{
    /** @var array<string, true> */
    public array $changed = [];

    /**
     * @param list<array{asset_id: int, autotile?: ?string}|null> $palette
     * @param list<array<string, mixed>>                          $layers
     * @param array<string, mixed>                                $ambient
     * @param list<array{id: int, uid: string, level: int, name: string, sort_order: int}> $floors in display order
     */
    public function __construct(
        public readonly int $revision,
        public string $name,
        public int $width,
        public int $height,
        public int $cellPx,
        public string $unitLabel,
        public int|float $unitPerCell,
        public string $theme,
        public array $ambient,
        public array $palette,
        public array $layers,
        array $floors,
    ) {
        $this->setFloors($floors);
    }

    /** @var list<int> ids of the floors of the map (kept in step with $floors) */
    public array $floorIds = [];

    /** @var list<array{id: int, uid: string, level: int, name: string, sort_order: int}> */
    public array $floors = [];

    /** True once a floor.* op changed the floors of the map. */
    public bool $floorsChanged = false;

    /**
     * @param list<array{id: int, uid: string, level: int, name: string, sort_order: int}> $floors
     */
    public function setFloors(array $floors): void
    {
        $this->floors = $floors;
        $this->floorIds = array_map(static fn (array $f): int => $f['id'], $floors);
    }

    /**
     * Floor id of a reference (numeric id or uid) among the floors of the map, null when unknown.
     */
    public function floorId(int|string $ref): ?int
    {
        foreach ($this->floors as $floor) {
            if (is_int($ref) ? $floor['id'] === $ref : $floor['uid'] === $ref) {
                return $floor['id'];
            }
        }

        return null;
    }

    /**
     * Marks a column as modified so it is written on save.
     */
    public function change(string $column): void
    {
        $this->changed[$column] = true;
    }

    /**
     * Asset referenced by a palette index (null for 0, an empty slot or an index out of range).
     */
    public function assetOf(int $index): ?int
    {
        $entry = $index > 0 ? ($this->palette[$index] ?? null) : null;

        return $entry === null ? null : $entry['asset_id'];
    }

    /**
     * Changed column => value, ready for MapRepository::update().
     *
     * @return array<string, mixed>
     */
    public function changedColumns(): array
    {
        $values = [
            'name' => $this->name,
            'cell_px' => $this->cellPx,
            'width_cells' => $this->width,
            'height_cells' => $this->height,
            'unit_label' => $this->unitLabel,
            'unit_per_cell' => $this->unitPerCell,
            'theme' => $this->theme,
            'ambient' => $this->ambient,
            'palette' => $this->palette,
            'layers' => $this->layers,
        ];

        return array_intersect_key($values, $this->changed);
    }
}
