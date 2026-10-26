<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\MapInput;

/**
 * Applies a lot of validated ops (MapOpsInput) to a locked map (projet.md 11.4, contract P4b).
 *
 * - tiles.set: last writer wins per cell; chunks are read (locked) once, edited in place;
 * - palette.add: append-only palette; same asset at the same index = no-op, another asset at a
 *   used index = 409 revision_conflict (the client must reload); index > size = 422;
 * - map.meta: name, grid, layers, theme, ambient; a width/height change is refused (409) when
 *   base_revision != revision; shrinking clears the cells left outside the map.
 *
 * - P5 ops (object.*, maptoken.*, fog.*): SceneApplier (conflicts collected per op; a shrink of
 *   the map also removes the objects / tokens / fog left outside).
 *
 * Asset reference deltas (cells per asset of the palette) are counted exactly, cell by cell.
 * The caller persists the dirty chunks, the deltas and the changed columns in the same
 * transaction (objects, tokens and fog are written by SceneApplier through its SceneStore).
 */
final class OpsApplier
{
    /** @var array<string, ChunkBuffer> */
    private array $buffers = [];

    /** @var array<int, int> asset_id => cell delta */
    private array $deltas = [];

    private ?SceneApplier $scene;

    /**
     * @param \Closure(int): bool $canUseAsset may the editor put this asset on the map
     * @param SceneStore|null     $sceneStore  objects / placed tokens / fog of the map (P5 ops)
     */
    public function __construct(
        private MapState $state,
        private ChunkStore $store,
        private \Closure $canUseAsset,
        ?SceneStore $sceneStore = null,
    ) {
        $this->scene = $sceneStore === null ? null : new SceneApplier($state, $sceneStore);
    }

    /**
     * @param list<array<string, mixed>> $ops normalized by MapOpsInput::ops()
     * @return int ops applied (conflicting ops and no-op removes excluded)
     * @throws ValidationException|ConflictException
     */
    public function apply(array $ops, int $baseRevision): int
    {
        $this->preload($ops);
        $this->scene?->preload($ops);
        $applied = 0;
        foreach ($ops as $i => $op) {
            $field = 'ops.' . $i;
            switch ($op['type']) {
                case 'tiles.set':
                    $this->tiles($op, $field);
                    break;
                case 'palette.add':
                    $this->palette($op, $field);
                    break;
                case 'map.meta':
                    $this->meta($op, $field, $baseRevision);
                    break;
                default:
                    if ($this->scene === null) {
                        throw new \LogicException('No scene store for ' . $op['type']);
                    }
                    if (!$this->scene->apply($op, $i)) {
                        continue 2;
                    }
            }
            $applied++;
        }
        $this->scene?->flush();

        return $applied;
    }

    /**
     * Object / placed-token ops rejected individually (SceneApplier::conflicts()).
     *
     * @return list<array<string, mixed>>
     */
    public function conflicts(): array
    {
        return $this->scene?->conflicts() ?? [];
    }

    /**
     * Changed chunks.
     *
     * @return list<ChunkBuffer>
     */
    public function dirtyChunks(): array
    {
        return array_values(array_filter($this->buffers, static fn (ChunkBuffer $b): bool => $b->dirty));
    }

    /**
     * @return array<int, int> asset_id => cell delta (non-zero only)
     */
    public function refDeltas(): array
    {
        return array_filter($this->deltas, static fn (int $d): bool => $d !== 0);
    }

    /**
     * Reads (and locks) every stored chunk touched by the tiles.set ops in one query per
     * floor/layer.
     *
     * @param list<array<string, mixed>> $ops
     */
    private function preload(array $ops): void
    {
        $wanted = [];
        foreach ($ops as $op) {
            if ($op['type'] !== 'tiles.set' || !in_array($op['floor'], $this->state->floorIds, true)) {
                continue;
            }
            $group = $op['floor'] . '|' . $op['layer'];
            foreach ($op['cells'] as [$x, $y]) {
                $wanted[$group][($x >> 5) . ':' . ($y >> 5)] = [$x >> 5, $y >> 5];
            }
        }
        foreach ($wanted as $group => $keys) {
            [$floorId, $layer] = explode('|', $group);
            $floorId = (int) $floorId;
            $stored = $this->store->lock($floorId, $layer, array_values($keys));
            foreach ($keys as $key => [$cx, $cy]) {
                $this->buffers[ChunkBuffer::key($floorId, $layer, $cx, $cy)] = isset($stored[$key])
                    ? new ChunkBuffer($floorId, $layer, $cx, $cy, $this->decode($stored[$key], $layer), true)
                    : new ChunkBuffer($floorId, $layer, $cx, $cy, ChunkCodec::emptyRaw($layer), false);
            }
        }
    }

    /**
     * @param array<string, mixed> $op
     */
    private function tiles(array $op, string $field): void
    {
        $floorId = $op['floor'];
        $layer = $op['layer'];
        if (!in_array($floorId, $this->state->floorIds, true)) {
            throw new ValidationException('', [$field . '.floor' => 'not_found']);
        }
        $size = count($this->state->palette);
        foreach ($op['cells'] as $j => [$x, $y, $index, $variant, $flags]) {
            if ($x >= $this->state->width || $y >= $this->state->height) {
                throw new ValidationException('', [$field . '.cells.' . $j => 'out_of_bounds']);
            }
            if ($index !== 0 && ($index >= $size || $this->state->palette[$index] === null)) {
                throw new ValidationException('', [$field . '.cells.' . $j => 'palette_index']);
            }
            $buffer = $this->buffer($floorId, $layer, $x >> 5, $y >> 5);
            $offset = ChunkCodec::offset($x & 31, $y & 31);
            [$oldIndex, $oldVariant, $oldFlags] = ChunkCodec::cellAt($buffer->raw, $offset);
            if ($oldIndex === $index && $oldVariant === $variant && $oldFlags === $flags) {
                continue;
            }
            ChunkCodec::setCell($buffer->raw, $offset, $index, $variant, $flags);
            $buffer->dirty = true;
            if ($oldIndex !== $index) {
                $this->count($this->state->assetOf($oldIndex), -1);
                $this->count($this->state->assetOf($index), 1);
            }
        }
    }

    /**
     * @param array<string, mixed> $op
     */
    private function palette(array $op, string $field): void
    {
        $index = $op['index'];
        $size = count($this->state->palette);
        if ($index > $size) {
            throw new ValidationException('', [$field . '.index' => 'palette_index']);
        }
        $current = $this->state->palette[$index] ?? null;
        if ($current !== null) {
            if ($current['asset_id'] !== $op['asset_id']) {
                throw new ConflictException('', [$field . '.index' => 'conflict']);
            }

            return;
        }
        if (!($this->canUseAsset)($op['asset_id'])) {
            throw new ValidationException('', [$field . '.asset_id' => 'not_found']);
        }
        $entry = ['asset_id' => $op['asset_id']];
        if ($op['autotile'] !== null) {
            $entry['autotile'] = $op['autotile'];
        }
        $this->state->palette[$index] = $entry;
        $this->state->change('palette');
    }

    /**
     * @param array<string, mixed> $op
     */
    private function meta(array $op, string $field, int $baseRevision): void
    {
        $s = $this->state;
        if (isset($op['name']) && $op['name'] !== $s->name) {
            $s->name = $op['name'];
            $s->change('name');
        }
        $grid = $op['grid'] ?? [];
        $width = $grid['width'] ?? $s->width;
        $height = $grid['height'] ?? $s->height;
        if ($width !== $s->width || $height !== $s->height) {
            if ($baseRevision !== $s->revision) {
                throw new ConflictException('', [$field . '.grid' => 'revision_conflict']);
            }
            if ($width < $s->width || $height < $s->height) {
                $this->shrink($width, $height);
                $this->scene?->shrink($width, $height);
            }
            $s->width = $width;
            $s->height = $height;
            $s->change('width_cells');
            $s->change('height_cells');
        }
        foreach (['cell_px' => 'cellPx', 'unit_label' => 'unitLabel', 'unit_per_cell' => 'unitPerCell'] as $key => $prop) {
            if (array_key_exists($key, $grid) && $grid[$key] !== $s->{$prop}) {
                $s->{$prop} = $grid[$key];
                $s->change($key);
            }
        }
        if (isset($op['layers']) && $op['layers'] !== $s->layers) {
            $s->layers = $op['layers'];
            $s->change('layers');
        }
        if (isset($op['theme']) && $op['theme'] !== $s->theme) {
            $s->theme = $op['theme'];
            $s->change('theme');
        }
        if (array_key_exists('ambient', $op)) {
            $errors = [];
            $ambient = MapInput::ambient($op['ambient'], $s->ambient, $field . '.ambient', $errors);
            if ($ambient === null) {
                throw new ValidationException('', $errors);
            }
            if ($ambient !== $s->ambient) {
                $s->ambient = $ambient;
                $s->change('ambient');
            }
        }
    }

    /**
     * Clears every cell at x >= $width or y >= $height, on every floor and layer.
     */
    private function shrink(int $width, int $height): void
    {
        foreach ($this->store->lockBeyond($width >> 5, $height >> 5) as $row) {
            $key = ChunkBuffer::key($row['floor_id'], $row['layer'], $row['cx'], $row['cy']);
            if (!isset($this->buffers[$key])) {
                $this->buffers[$key] = new ChunkBuffer(
                    $row['floor_id'],
                    $row['layer'],
                    $row['cx'],
                    $row['cy'],
                    $this->decode($row['data'], $row['layer']),
                    true,
                );
            }
        }
        foreach ($this->buffers as $buffer) {
            $x0 = $buffer->cx << 5;
            $y0 = $buffer->cy << 5;
            if ($x0 + 31 < $width && $y0 + 31 < $height) {
                continue;
            }
            for ($y = 0; $y < 32; $y++) {
                for ($x = 0; $x < 32; $x++) {
                    if ($x0 + $x < $width && $y0 + $y < $height) {
                        continue;
                    }
                    $offset = ChunkCodec::offset($x, $y);
                    $index = ChunkCodec::indexAt($buffer->raw, $offset);
                    if ($index === 0) {
                        continue;
                    }
                    ChunkCodec::setCell($buffer->raw, $offset, 0, 0, 0);
                    $buffer->dirty = true;
                    $this->count($this->state->assetOf($index), -1);
                }
            }
        }
    }

    private function buffer(int $floorId, string $layer, int $cx, int $cy): ChunkBuffer
    {
        $key = ChunkBuffer::key($floorId, $layer, $cx, $cy);
        if (!isset($this->buffers[$key])) {
            // Not preloaded (cannot happen for valid ops): read it now.
            $stored = $this->store->lock($floorId, $layer, [[$cx, $cy]]);
            $data = $stored[$cx . ':' . $cy] ?? null;
            $this->buffers[$key] = $data === null
                ? new ChunkBuffer($floorId, $layer, $cx, $cy, ChunkCodec::emptyRaw($layer), false)
                : new ChunkBuffer($floorId, $layer, $cx, $cy, $this->decode($data, $layer), true);
        }

        return $this->buffers[$key];
    }

    private function decode(string $data, string $layer): string
    {
        return ChunkCodec::decode($data, $layer, count($this->state->palette));
    }

    private function count(?int $assetId, int $delta): void
    {
        if ($assetId !== null) {
            $this->deltas[$assetId] = ($this->deltas[$assetId] ?? 0) + $delta;
        }
    }
}
