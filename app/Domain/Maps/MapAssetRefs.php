<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Maps\ChunkCodec;
use JDR\Maps\ObjectRulesImage;

/**
 * What map_asset_refs must contain: cells per asset of the palette (chunks) + one per note carrying
 * an asset + one per image object (P14). Shared by the writer of whole documents and by the integrity check (P10b).
 */
final class MapAssetRefs
{
    public function __construct(private Db $db)
    {
    }

    /**
     * Adds to $counts the cells of a raw block per asset of the palette.
     *
     * @param list<array{asset_id: int, autotile?: string}|null> $palette
     * @param array<int, int>                                    $counts  asset id => cells
     */
    public static function addChunk(string $raw, array $palette, array &$counts): void
    {
        foreach (ChunkCodec::indexCounts($raw) as $index => $n) {
            $assetId = $palette[$index]['asset_id'] ?? null;
            if ($assetId !== null) {
                $counts[$assetId] = ($counts[$assetId] ?? 0) + $n;
            }
        }
    }

    /**
     * Notes of a map using an asset, per asset.
     *
     * @return array<int, int> asset id => notes
     */
    public function noteCounts(int $mapId): array
    {
        $out = [];
        $rows = $this->db->fetchAll(
            'SELECT `asset_id`, COUNT(*) AS n FROM ' . $this->db->t('map_notes')
            . ' WHERE `map_id` = ? AND `asset_id` IS NOT NULL GROUP BY `asset_id`',
            [$mapId],
        );
        foreach ($rows as $r) {
            $out[(int) $r['asset_id']] = (int) $r['n'];
        }

        return $out;
    }

    /**
     * Assets referenced by the objects of a map (P14 image objects, wall textures and door images): one reference each.
     *
     * @return array<int, int> asset id => images
     */
    public function imageCounts(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `type`, `props` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `type` IN (?, ?, ?)',
            [$mapId, ObjectRulesImage::TYPE, 'wall', 'door'],
        );

        return ObjectRulesImage::counts(array_map(static function (array $r): array {
            $props = json_decode((string) $r['props'], true);

            return ['type' => (string) $r['type'], 'props' => is_array($props) ? $props : []];
        }, $rows));
    }
}
