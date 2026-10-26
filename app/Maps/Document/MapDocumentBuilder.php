<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;

/**
 * Builds the map document (projet.md 12.1, format_version 1) from the database: grid, theme,
 * ambient, palette ("sha256:<hex>" + asset name + autotile; null for an empty slot or an asset
 * row that no longer exists), layers, floors (uid "f1", "f2"... in floor order), chunks in base64
 * (stored raw-deflate bytes) by floor uid / layer / "cx:cy", generation. P5: fog (floor uid =>
 * "cx:cy" => base64 raw deflate), objects (API form without rev, floor = floor uid) and placed
 * tokens ({uid, token: "ref:token:<name>", floor, x, y, rotation, scale, hidden,
 * light_override}). Notes and links (P9): empty.
 *
 * Internal documents (version snapshots) also carry the palette asset_id and the token_id of
 * the placed tokens, so that a restore finds the exact asset / token again on this server.
 *
 * Call inside a transaction when a consistent read matters (snapshots, export).
 */
final class MapDocumentBuilder
{
    public const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;

    public function __construct(private MapRepository $maps, private Db $db, private MapSceneRepository $scene)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function build(Map $map, bool $internal = false): array
    {
        $floors = $this->maps->floors($map->id);
        $uids = [];
        $docFloors = [];
        foreach ($floors as $i => $floor) {
            $uid = 'f' . ($i + 1);
            $uids[$floor['id']] = $uid;
            $docFloors[] = ['uid' => $uid, 'level' => $floor['level'], 'name' => $floor['name']];
        }
        $chunks = [];
        foreach ($uids as $uid) {
            $chunks[$uid] = array_fill_keys(MapInput::TILE_LAYERS, []);
        }
        foreach ($this->maps->allChunks($map->id) as $chunk) {
            $uid = $uids[$chunk['floor_id']] ?? null;
            if ($uid !== null && isset($chunks[$uid][$chunk['layer']])) {
                $chunks[$uid][$chunk['layer']][$chunk['cx'] . ':' . $chunk['cy']] = base64_encode($chunk['data']);
            }
        }
        foreach ($chunks as $uid => $layers) {
            $layers = array_filter($layers, static fn (array $blocks): bool => $blocks !== []);
            $chunks[$uid] = $layers === [] ? new \stdClass() : $layers;
        }

        return [
            'format' => MapDocumentValidator::FORMAT,
            'format_version' => MapDocumentMigrator::CURRENT,
            'app_version' => \APP_VERSION,
            'name' => $map->name,
            'kind' => $map->kind,
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
            'palette' => $this->palette($map, $internal),
            'layers' => $map->layers,
            'floors' => $docFloors,
            'chunks' => $chunks === [] ? new \stdClass() : $chunks,
            'fog' => $this->fog($map->id, $uids),
            'objects' => $this->objects($map->id, $uids),
            'notes' => [],
            'links' => [],
            'tokens_placed' => $this->tokens($map->id, $uids, $internal),
            'generation' => $this->generation($map->id),
        ];
    }

    /**
     * Assets of the palette that still exist (export ZIP): id => {uuid, ext, sha256, deleted}.
     *
     * @return array<int, array{uuid: string, ext: string, sha256: string, name: string, deleted: bool}>
     */
    public function paletteAssets(Map $map): array
    {
        $ids = [];
        foreach ($map->palette as $entry) {
            if ($entry !== null) {
                $ids[$entry['asset_id']] = $entry['asset_id'];
            }
        }
        $out = [];
        foreach (array_chunk(array_values($ids), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id`, `uuid`, `ext`, `sha256`, `name`, `deleted_at` FROM ' . $this->db->t('assets') . ' WHERE `id` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                $batch,
            );
            foreach ($rows as $r) {
                $out[(int) $r['id']] = [
                    'uuid' => (string) $r['uuid'],
                    'ext' => (string) $r['ext'],
                    'sha256' => strtolower((string) $r['sha256']),
                    'name' => (string) $r['name'],
                    'deleted' => $r['deleted_at'] !== null,
                ];
            }
        }

        return $out;
    }

    /**
     * JSON text of a document.
     *
     * @param array<string, mixed> $doc
     */
    public static function encode(array $doc, bool $pretty = false): string
    {
        return json_encode($doc, self::JSON_FLAGS | ($pretty ? JSON_PRETTY_PRINT : 0));
    }

    /**
     * @return list<array<string, mixed>|null>
     */
    private function palette(Map $map, bool $internal): array
    {
        $assets = $this->paletteAssets($map);
        $out = [];
        foreach ($map->palette as $entry) {
            $asset = $entry === null ? null : ($assets[$entry['asset_id']] ?? null);
            if ($entry === null || $asset === null) {
                $out[] = null;
                continue;
            }
            $item = ['asset' => 'sha256:' . $asset['sha256'], 'name' => $asset['name'], 'autotile' => $entry['autotile'] ?? null];
            if ($internal) {
                $item['asset_id'] = $entry['asset_id'];
            }
            $out[] = $item;
        }

        return $out;
    }

    /**
     * @param array<int, string> $uids floor id => floor uid
     */
    private function fog(int $mapId, array $uids): object|array
    {
        $fog = [];
        foreach ($this->scene->allFog($mapId) as $chunk) {
            $uid = $uids[$chunk['floor_id']] ?? null;
            if ($uid !== null) {
                $fog[$uid][$chunk['cx'] . ':' . $chunk['cy']] = base64_encode($chunk['data']);
            }
        }

        return $fog === [] ? new \stdClass() : $fog;
    }

    /**
     * @param array<int, string> $uids floor id => floor uid
     * @return list<array<string, mixed>>
     */
    private function objects(int $mapId, array $uids): array
    {
        $out = [];
        foreach ($this->scene->objects($mapId) as $object) {
            $uid = $uids[(int) $object['floor']] ?? null;
            if ($uid === null) {
                continue;
            }
            $object['floor'] = $uid;
            unset($object['rev']);
            $out[] = $object;
        }

        return $out;
    }

    /**
     * @param array<int, string> $uids floor id => floor uid
     * @return list<array<string, mixed>>
     */
    private function tokens(int $mapId, array $uids, bool $internal): array
    {
        $out = [];
        foreach ($this->scene->tokensWithNames($mapId) as ['token' => $t, 'name' => $name]) {
            $uid = $uids[(int) $t['floor']] ?? null;
            if ($uid === null) {
                continue;
            }
            $item = [
                'uid' => $t['uid'],
                'token' => 'ref:token:' . $name,
                'floor' => $uid,
                'x' => $t['x'],
                'y' => $t['y'],
                'rotation' => $t['rotation'],
                'scale' => $t['scale'],
                'hidden' => $t['hidden'],
                'light_override' => $t['light_override'],
            ];
            if ($internal) {
                $item['token_id'] = $t['token_id'];
            }
            $out[] = $item;
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function generation(int $mapId): ?array
    {
        $json = $this->db->fetchValue('SELECT `generation` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$mapId]);
        $data = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($data)) {
            return null;
        }
        // MySQL JSON columns do not keep the key order: canonical order of 12.1.
        $params = $data['params'] ?? [];

        return [
            'generator' => $data['generator'] ?? null,
            'gen_version' => $data['gen_version'] ?? null,
            'seed' => $data['seed'] ?? null,
            'params' => $params === [] || !is_array($params) ? new \stdClass() : $params,
        ];
    }
}
