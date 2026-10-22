<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapRepository;
use JDR\Maps\ChunkCodec;

/**
 * Writes a validated document (MapDocumentValidator::validate()) into the database, inside the
 * caller's transaction:
 * - create(): a new map of a game (import), revision 0;
 * - replace(): the content of an existing, locked map (version restore) in a NEW revision:
 *   meta columns, floors matched by level (kept ids; missing ones created, extra ones deleted),
 *   every chunk rewritten.
 * map_asset_refs are recomputed from the written cells (cells per asset of the palette; slots
 * left empty count nothing).
 *
 * $palette is the resolved palette: [null, {asset_id, autotile?} | null, ...], same length as
 * the document palette (an unresolved asset keeps its index, empty).
 */
final class MapDocumentWriter
{
    public function __construct(private MapRepository $maps, private Db $db)
    {
    }

    /**
     * @param array<string, mixed>                                $doc normalized document
     * @param list<array{asset_id: int, autotile?: string}|null> $palette
     * @return int new map id
     */
    public function create(int $gameId, int $ownerId, ?string $folder, array $doc, array $palette): int
    {
        $grid = $doc['grid'];
        $id = $this->maps->insert([
            'game_id' => $gameId,
            'owner_user_id' => $ownerId,
            'name' => $doc['name'],
            'folder' => $folder,
            'sort_order' => $this->maps->nextSortOrder($gameId),
            'kind' => $doc['kind'],
            'cell_px' => $grid['cell_px'],
            'width' => $grid['width'],
            'height' => $grid['height'],
            'unit_label' => $grid['unit_label'],
            'unit_per_cell' => $grid['unit_per_cell'],
            'theme' => $doc['theme'],
            'ambient' => $doc['ambient'],
            'palette' => $palette,
            'layers' => $doc['layers'],
        ]);
        $this->writeExtra($id, $doc);
        $floorIds = [];
        foreach ($doc['floors'] as $i => $floor) {
            $floorIds[$floor['uid']] = $this->maps->insertFloor($id, $floor['level'], $floor['name'], $i);
        }
        $this->writeChunks($id, $floorIds, $doc['chunks'], $palette, 0);

        return $id;
    }

    /**
     * @param array<string, mixed>                                $doc normalized document
     * @param list<array{asset_id: int, autotile?: string}|null> $palette
     * @return int new revision
     */
    public function replace(Map $locked, array $doc, array $palette): int
    {
        $grid = $doc['grid'];
        $this->maps->update($locked->id, [
            'name' => $doc['name'],
            'cell_px' => $grid['cell_px'],
            'width_cells' => $grid['width'],
            'height_cells' => $grid['height'],
            'unit_label' => $grid['unit_label'],
            'unit_per_cell' => $grid['unit_per_cell'],
            'theme' => $doc['theme'],
            'ambient' => $doc['ambient'],
            'palette' => $palette,
            'layers' => $doc['layers'],
        ], true);
        $this->writeExtra($locked->id, $doc);
        $revision = $locked->revision + 1;

        $existing = [];
        foreach ($this->maps->floors($locked->id) as $floor) {
            $existing[$floor['level']] = $floor['id'];
        }
        $this->db->execute('DELETE FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ?', [$locked->id]);
        $this->db->execute('DELETE FROM ' . $this->db->t('map_asset_refs') . ' WHERE `map_id` = ?', [$locked->id]);
        $wanted = array_flip(array_column($doc['floors'], 'level'));
        foreach ($existing as $level => $floorId) {
            if (!isset($wanted[$level])) {
                $this->db->execute('DELETE FROM ' . $this->db->t('map_floors') . ' WHERE `id` = ?', [$floorId]);
            }
        }
        $floorIds = [];
        foreach ($doc['floors'] as $i => $floor) {
            if (isset($existing[$floor['level']])) {
                $floorIds[$floor['uid']] = $existing[$floor['level']];
                $this->db->execute(
                    'UPDATE ' . $this->db->t('map_floors') . ' SET `name` = ?, `sort_order` = ? WHERE `id` = ?',
                    [$floor['name'], $i, $existing[$floor['level']]],
                );
            } else {
                $floorIds[$floor['uid']] = $this->maps->insertFloor($locked->id, $floor['level'], $floor['name'], $i);
            }
        }
        $this->writeChunks($locked->id, $floorIds, $doc['chunks'], $palette, $revision);

        return $revision;
    }

    /**
     * Columns that MapRepository does not write: kind, generation.
     *
     * @param array<string, mixed> $doc
     */
    private function writeExtra(int $mapId, array $doc): void
    {
        $generation = $doc['generation'] ?? null;
        $this->db->execute(
            'UPDATE ' . $this->db->t('maps') . ' SET `kind` = ?, `generation` = ? WHERE `id` = ?',
            [$doc['kind'], $generation === null ? null : json_encode($generation, MapRepository::JSON_FLAGS), $mapId],
        );
    }

    /**
     * @param array<string, int>                                  $floorIds uid => floor id
     * @param list<array{floor: string, layer: string, cx: int, cy: int, raw: string}> $chunks
     * @param list<array{asset_id: int, autotile?: string}|null> $palette
     */
    private function writeChunks(int $mapId, array $floorIds, array $chunks, array $palette, int $revision): void
    {
        $counts = [];
        foreach ($chunks as $chunk) {
            $this->maps->insertChunk(
                $mapId,
                $floorIds[$chunk['floor']],
                $chunk['layer'],
                $chunk['cx'],
                $chunk['cy'],
                ChunkCodec::compress($chunk['raw']),
                $revision,
            );
            foreach (ChunkCodec::indexCounts($chunk['raw']) as $index => $n) {
                $assetId = $palette[$index]['asset_id'] ?? null;
                if ($assetId !== null) {
                    $counts[$assetId] = ($counts[$assetId] ?? 0) + $n;
                }
            }
        }
        $this->maps->applyRefDeltas($mapId, $counts);
    }
}
