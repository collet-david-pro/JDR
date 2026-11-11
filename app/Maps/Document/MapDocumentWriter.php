<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapFloorRepository;
use JDR\Domain\Maps\MapAssetRefs;
use JDR\Domain\Maps\MapFloors;
use JDR\Domain\Maps\MapLinks;
use JDR\Domain\Maps\MapNotes;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Maps\ChunkCodec;
use JDR\Maps\FogCodec;
use JDR\Maps\ObjectRules;
use JDR\Maps\ObjectRulesImage;

/**
 * Writes a validated document (MapDocumentValidator::validate()) into the database, inside the
 * caller's transaction:
 * - create(): a new map of a game (import), revision 0;
 * - replace(): the content of an existing, locked map (version restore) in a NEW revision:
 *   meta columns, floors matched by uid (kept ids; missing ones created, extra ones deleted, the
 *   sessions standing on them move to the first floor), every chunk rewritten.
 * P9a: floor uids are written as they are (a numeric one, ambiguous with an id, is renumbered);
 * links (props.link of door / stairs / portal) are attached by map name on import (create()), kept
 * as they are on restore, and map_links is rebuilt.
 * map_asset_refs are recomputed from the written cells (cells per asset of the palette; slots
 * left empty count nothing) + one per note with an image and per image object (P14).
 * P5: objects (bounding boxes computed, rev 1), placed tokens (definition resolved by
 * resolveTokens(): a token that cannot be resolved is skipped) and fog chunks are written too;
 * replace() deletes the previous ones first.
 *
 * $palette is the resolved palette: [null, {asset_id, autotile?} | null, ...], same length as
 * the document palette (an unresolved asset keeps its index, empty).
 */
final class MapDocumentWriter
{
    public function __construct(
        private MapRepository $maps,
        private Db $db,
        private MapSceneRepository $scene,
        private MapFloorRepository $floorRows,
        private MapLinks $links,
        private MapNotes $notes,
    ) {
    }

    /**
     * Token definitions of the placed tokens of a document in the game $gameId: the recorded
     * token_id when $useIds (snapshot) and it is a live token of the game, else the first live
     * token of the game with that exact name (by id). Unresolved names are listed in missing.
     *
     * @param list<array<string, mixed>> $tokens normalized tokens_placed
     * @return array{ids: list<int|null>, missing: list<string>}
     */
    public function resolveTokens(int $gameId, array $tokens, bool $useIds): array
    {
        if ($tokens === []) {
            return ['ids' => [], 'missing' => []];
        }
        $names = array_map(static fn (array $t): string => (string) $t['token'], $tokens);
        $ids = $useIds ? array_values(array_filter(array_map(static fn (array $t): ?int => $t['token_id'] ?? null, $tokens))) : [];
        $found = $this->scene->gameTokens($gameId, $names, $ids);
        $out = [];
        $missing = [];
        foreach ($tokens as $t) {
            $id = $useIds && isset($t['token_id'], $found['ids'][$t['token_id']]) ? (int) $t['token_id'] : ($found['names'][$t['token']] ?? null);
            if ($id === null) {
                $missing[$t['token']] = true;
            }
            $out[] = $id;
        }

        return ['ids' => $out, 'missing' => array_map('strval', array_keys($missing))];
    }

    /**
     * @param array<string, mixed>                                $doc normalized document
     * @param list<array{asset_id: int, autotile?: string}|null> $palette
     * @param list<int|null>                                      $tokenIds resolveTokens()['ids']
     * @return int new map id
     */
    public function create(int $gameId, int $ownerId, ?string $folder, array $doc, array $palette, array $tokenIds = []): int
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
        $dbUids = self::floorUids($doc['floors']);
        foreach ($doc['floors'] as $i => $floor) {
            $floorIds[$floor['uid']] = $this->maps->insertFloor($id, $dbUids[$floor['uid']], $floor['level'], $floor['name'], $i);
        }
        $doc['objects'] = $this->attachLinks($gameId, $id, $doc['name'], self::renameToFloors($doc['objects'] ?? [], $dbUids), $dbUids);
        $this->writeChunks($id, $floorIds, $doc['chunks'], $palette, 0);
        $this->writeScene($id, $floorIds, $doc, $tokenIds);
        $this->links->rebuildMap($id);

        return $id;
    }

    /**
     * @param array<string, mixed>                                $doc normalized document
     * @param list<array{asset_id: int, autotile?: string}|null> $palette
     * @param list<int|null>                                      $tokenIds resolveTokens()['ids']
     * @return int new revision
     */
    public function replace(Map $locked, array $doc, array $palette, array $tokenIds = []): int
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
            $existing[$floor['uid']] = $floor['id'];
        }
        $this->db->execute('DELETE FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ?', [$locked->id]);
        $this->db->execute('DELETE FROM ' . $this->db->t('map_asset_refs') . ' WHERE `map_id` = ?', [$locked->id]);
        $this->scene->clear($locked->id);
        $this->floorRows->parkLevels($locked->id);
        $dbUids = self::floorUids($doc['floors']);
        $floorIds = [];
        foreach ($doc['floors'] as $i => $floor) {
            $uid = $dbUids[$floor['uid']];
            if (isset($existing[$uid])) {
                $floorIds[$floor['uid']] = $existing[$uid];
                $this->floorRows->update($existing[$uid], ['level' => $floor['level'], 'name' => $floor['name'], 'sort_order' => $i]);
            } else {
                $floorIds[$floor['uid']] = $this->maps->insertFloor($locked->id, $uid, $floor['level'], $floor['name'], $i);
            }
        }
        $first = (int) reset($floorIds);
        foreach ($existing as $uid => $floorId) {
            if (!in_array($uid, $dbUids, true)) {
                $this->floorRows->moveSessions($locked->id, $floorId, $first);
                $this->floorRows->delete($floorId);
            }
        }
        $doc['objects'] = self::renameToFloors($doc['objects'] ?? [], $dbUids);
        $this->writeChunks($locked->id, $floorIds, $doc['chunks'], $palette, $revision);
        $this->writeScene($locked->id, $floorIds, $doc, $tokenIds);
        $this->links->rebuildMap($locked->id);

        return $revision;
    }

    /**
     * Objects, placed tokens (skipped when their definition is not resolved) and fog.
     *
     * @param array<string, int>   $floorIds uid => floor id
     * @param array<string, mixed> $doc
     * @param list<int|null>       $tokenIds
     */
    private function writeScene(int $mapId, array $floorIds, array $doc, array $tokenIds): void
    {
        $width = (float) $doc['grid']['width'];
        $height = (float) $doc['grid']['height'];
        $images = [];
        foreach ($doc['objects'] ?? [] as $object) {
            if (ObjectRulesImage::handles($object['type']) && ObjectRulesImage::assetId($object) === null) {
                continue; // P14: an image whose asset was not resolved (MapDocumentImages::resolve)
            }
            unset($object['asset'], $object['assets']);
            $object['floor'] = $floorIds[$object['floor']];
            $object['rev'] = 1;
            $this->scene->insertObject($mapId, $object, ObjectRules::bbox($object, $width, $height));
            $images[] = $object;
        }
        $this->maps->applyRefDeltas($mapId, ObjectRulesImage::counts($images));
        foreach ($doc['tokens_placed'] ?? [] as $i => $token) {
            $tokenId = $tokenIds[$i] ?? null;
            if ($tokenId === null) {
                continue;
            }
            $this->scene->insertToken($mapId, [
                'uid' => $token['uid'],
                'floor' => $floorIds[$token['floor']],
                'token_id' => $tokenId,
                'x' => $token['x'],
                'y' => $token['y'],
                'rotation' => $token['rotation'],
                'scale' => $token['scale'],
                'hidden' => $token['hidden'],
                'light_override' => $token['light_override'],
                'rev' => 1,
            ]);
        }
        foreach ($doc['fog'] ?? [] as $chunk) {
            $this->scene->insertFog($mapId, $floorIds[$chunk['floor']], $chunk['cx'], $chunk['cy'], FogCodec::encode($chunk['raw']));
        }
        $this->maps->applyRefDeltas($mapId, $this->notes->writeDocument($mapId, $doc));
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
            MapAssetRefs::addChunk($chunk['raw'], $palette, $counts);
        }
        $this->maps->applyRefDeltas($mapId, $counts);
    }

    /**
     * Uid stored for each floor of the document (document uid => stored uid): the same, except a
     * numeric one (ambiguous with a floor id), which becomes the first free "f<n>".
     *
     * @param list<array{uid: string, level: int, name: string}> $floors
     * @return array<string, string>
     */
    private static function floorUids(array $floors): array
    {
        $taken = array_column($floors, 'uid', 'uid');
        $out = [];
        $n = 0;
        foreach ($floors as $floor) {
            $uid = $floor['uid'];
            if (!MapFloors::isUid($uid)) {
                do {
                    $uid = MapFloors::defaultUid($n++);
                } while (isset($taken[$uid]));
                $taken[$uid] = $uid;
            }
            $out[$floor['uid']] = $uid;
        }

        return $out;
    }

    /**
     * Objects whose stairs.props.to_floor follows the renamed floors.
     *
     * @param list<array<string, mixed>> $objects
     * @param array<string, string>      $dbUids document uid => stored uid
     * @return list<array<string, mixed>>
     */
    private static function renameToFloors(array $objects, array $dbUids): array
    {
        foreach ($objects as $i => $object) {
            $to = $object['props']['to_floor'] ?? null;
            if ($object['type'] === 'stairs' && is_string($to) && isset($dbUids[$to])) {
                $objects[$i]['props']['to_floor'] = $dbUids[$to];
            }
        }

        return $objects;
    }

    /**
     * Import: the links of the objects are attached to the map of the game that bears the hinted
     * name (props.link.map_name; the name of the imported map itself = the new map), otherwise they
     * are kept as broken links ({map_id: null, broken: true}).
     *
     * @param list<array<string, mixed>> $objects
     * @param array<string, string>      $dbUids document floor uid => stored uid (floor of a link to the map itself)
     * @return list<array<string, mixed>>
     */
    private function attachLinks(int $gameId, int $newMapId, string $newName, array $objects, array $dbUids): array
    {
        $names = [];
        foreach ($objects as $object) {
            $name = $object['props']['link']['map_name'] ?? null;
            if (is_string($name)) {
                $names[$name] = true;
            }
        }
        $found = [];
        if ($names !== []) {
            $rows = $this->db->fetchAll(
                'SELECT `id`, `name` FROM ' . $this->db->t('maps') . ' WHERE `game_id` = ? AND `deleted_at` IS NULL AND `name` IN ('
                . implode(', ', array_fill(0, count($names), '?')) . ') ORDER BY `id` DESC',
                [$gameId, ...array_keys($names)],
            );
            foreach ($rows as $r) {
                $found[(string) $r['name']] = (int) $r['id'];
            }
        }
        foreach ($objects as $i => $object) {
            $link = $object['props']['link'] ?? null;
            if (!is_array($link)) {
                continue;
            }
            $name = $link['map_name'] ?? null;
            $target = !is_string($name) ? null : ($name === $newName ? $newMapId : ($found[$name] ?? null));
            if ($target === null) {
                $link['map_id'] = null;
                $link['broken'] = true;
            } else {
                $link['map_id'] = $target;
                unset($link['broken']);
                if ($target === $newMapId && is_string($link['floor'] ?? null) && isset($dbUids[$link['floor']])) {
                    $link['floor'] = $dbUids[$link['floor']];
                }
            }
            $objects[$i]['props']['link'] = $link;
        }

        return $objects;
    }
}
