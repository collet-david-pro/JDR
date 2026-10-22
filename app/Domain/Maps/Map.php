<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

/**
 * Row of the maps table (projet.md 7.2). JSON columns are decoded (opaque for SQL, validated by
 * PHP before every write): ambient, palette ([null, {asset_id, autotile?}, ...]), layers.
 */
final class Map
{
    public const FORMAT_VERSION = 1;
    public const KINDS = ['battle', 'world'];
    public const THEMES = ['parchment', 'slate', 'blueprint', 'dark', 'light'];

    /**
     * @param array<string, mixed>                                     $ambient
     * @param list<array{asset_id: int, autotile?: ?string}|null>      $palette
     * @param list<array<string, mixed>>                               $layers
     */
    public function __construct(
        public readonly int $id,
        public readonly ?int $gameId,
        public readonly int $ownerUserId,
        public readonly string $name,
        public readonly ?string $folder,
        public readonly int $sortOrder,
        public readonly string $kind,
        public readonly string $gridType,
        public readonly int $cellPx,
        public readonly int $width,
        public readonly int $height,
        public readonly string $unitLabel,
        public readonly int|float $unitPerCell,
        public readonly string $theme,
        public readonly array $ambient,
        public readonly array $palette,
        public readonly array $layers,
        public readonly int $formatVersion,
        public readonly int $revision,
        public readonly ?string $thumbAssetPath,
        public readonly string $createdAt,
        public readonly string $updatedAt,
        public readonly ?string $deletedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $unit = (float) $row['unit_per_cell'];

        return new self(
            (int) $row['id'],
            $row['game_id'] === null ? null : (int) $row['game_id'],
            (int) $row['owner_user_id'],
            (string) $row['name'],
            $row['folder'] === null || $row['folder'] === '' ? null : (string) $row['folder'],
            (int) $row['sort_order'],
            (string) $row['kind'],
            (string) $row['grid_type'],
            (int) $row['cell_px'],
            (int) $row['width_cells'],
            (int) $row['height_cells'],
            (string) $row['unit_label'],
            floor($unit) === $unit ? (int) $unit : $unit,
            (string) $row['theme'],
            MapInput::storedAmbient($row['ambient']),
            MapInput::storedPalette($row['palette']),
            MapInput::storedLayers($row['layers']),
            (int) $row['format_version'],
            (int) $row['revision'],
            $row['thumb_asset_path'] === null ? null : (string) $row['thumb_asset_path'],
            (string) $row['created_at'],
            (string) $row['updated_at'],
            $row['deleted_at'] === null ? null : (string) $row['deleted_at'],
        );
    }

    /**
     * Number of palette slots (index 0 included): every cell index must be below it.
     */
    public function paletteSize(): int
    {
        return count($this->palette);
    }
}
