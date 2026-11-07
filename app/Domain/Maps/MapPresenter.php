<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Maps\Transfer\MapThumbnailService;
use JDR\Domain\Support\Dates;
use JDR\Maps\ObjectRulesImage;

/**
 * API representations "MapSummary" and "Map" (contract P4b). Only call for an editor of the
 * game (D8: palette URLs are signed for the GM / co-GMs only). thumb_url: signed URL of the
 * thumbnail (P4c, MapThumbnailService), null without thumbnail.
 * P5: objects of every floor sorted by floor, sort_order, id, and placed tokens (GM view: nothing
 * filtered; players get JDR\Maps\PlayerFilter in P6). notes stay empty until P9. P14: images =
 * assets of the image objects (images()).
 */
final class MapPresenter
{
    public function __construct(
        private MapRepository $maps,
        private AssetUrls $urls,
        private MapThumbnailService $thumbs,
        private MapSceneRepository $scene,
        private MapNotes $notes,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(Map $map, string $apiBase): array
    {
        return [
            'id' => $map->id,
            'game_id' => $map->gameId,
            'name' => $map->name,
            'folder' => $map->folder,
            'sort_order' => $map->sortOrder,
            'kind' => $map->kind,
            'grid' => ['width' => $map->width, 'height' => $map->height],
            'thumb_url' => $this->thumbs->url($apiBase, $map),
            'revision' => $map->revision,
            'updated_at' => Dates::iso($map->updatedAt),
            'deleted_at' => Dates::iso($map->deletedAt),
        ];
    }

    /**
     * @param list<Map> $maps
     * @return list<array<string, mixed>>
     */
    public function summaries(array $maps, string $apiBase): array
    {
        return array_map(fn (Map $m): array => $this->summary($m, $apiBase), $maps);
    }

    /**
     * @param bool $withNotes the reader is a GM / co-GM (refusal by default: the notes are never
     *                        given by mistake; a player's come from PlayerView)
     * @return array<string, mixed>
     */
    public function full(Map $map, string $apiBase, bool $withNotes = false): array
    {
        $objects = $this->scene->objects($map->id);

        return [
            ...$this->summary($map, $apiBase),
            'grid' => [
                'type' => $map->gridType,
                'cell_px' => $map->cellPx,
                'width' => $map->width,
                'height' => $map->height,
                'unit_label' => $map->unitLabel,
                'unit_per_cell' => $map->unitPerCell,
            ],
            'theme' => $map->theme,
            'ambient' => $map->ambient,
            'palette' => $this->palette($map, $apiBase),
            'layers' => $map->layers,
            'floors' => $this->maps->floors($map->id),
            'format_version' => $map->formatVersion,
            'objects' => $objects,
            'images' => $this->images($objects, $apiBase),
            'notes' => $withNotes ? $this->notes->forEditor($map->id) : [],
            'tokens_placed' => $this->scene->tokens($map->id),
            'generation' => $this->maps->generation($map->id),
        ];
    }

    /**
     * Assets of the image objects among $objects (P14), by asset id order:
     * [{asset_id, name, url, thumb_url, width, height, animated}]; url / thumb_url null when the asset
     * is deleted (the client draws a placeholder). Only give it for objects the reader sees.
     *
     * @param list<array<string, mixed>> $objects
     * @return list<array<string, mixed>>
     */
    public function images(array $objects, string $apiBase): array
    {
        $ids = array_keys(ObjectRulesImage::counts($objects));
        sort($ids);
        $assets = $ids === [] ? [] : $this->scene->imageAssets($ids);
        $out = [];
        foreach ($ids as $id) {
            $asset = $assets[$id] ?? null;
            $live = $asset !== null && !$asset['deleted'];
            $out[] = [
                'asset_id' => (string) $id,
                'name' => $asset['name'] ?? '',
                'url' => $live ? $this->urls->url($apiBase, $asset['uuid'], 'full') : null,
                'thumb_url' => $live ? $this->urls->url($apiBase, $asset['uuid'], 'thumb') : null,
                'width' => $asset['width'] ?? 0,
                'height' => $asset['height'] ?? 0,
                'animated' => $asset['animated'] ?? false,
            ];
        }

        return $out;
    }

    /**
     * [null | {asset_id, name, url, thumb_url, autotile}]; url/thumb_url null when the asset is
     * deleted (the client shows the "missing" texture).
     *
     * @return list<array<string, mixed>|null>
     */
    private function palette(Map $map, string $apiBase): array
    {
        $ids = [];
        foreach ($map->palette as $entry) {
            if ($entry !== null) {
                $ids[] = $entry['asset_id'];
            }
        }
        $assets = $this->maps->paletteAssets($ids);
        $out = [];
        foreach ($map->palette as $entry) {
            if ($entry === null) {
                $out[] = null;
                continue;
            }
            $asset = $assets[$entry['asset_id']] ?? null;
            $live = $asset !== null && !$asset['deleted'];
            $out[] = [
                'asset_id' => $entry['asset_id'],
                'name' => $asset['name'] ?? '',
                'url' => $live ? $this->urls->url($apiBase, $asset['uuid'], 'full') : null,
                'thumb_url' => $live ? $this->urls->url($apiBase, $asset['uuid'], 'thumb') : null,
                'autotile' => $entry['autotile'] ?? null,
                'repeat' => $entry['repeat'] ?? null,
            ];
        }

        return $out;
    }
}
