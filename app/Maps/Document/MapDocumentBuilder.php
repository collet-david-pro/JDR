<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapRepository;

/**
 * Builds the map document (projet.md 12.1, format_version 1) from the database: grid, theme,
 * ambient, palette ("sha256:<hex>" + asset name + autotile; null for an empty slot or an asset
 * row that no longer exists), layers, floors (uid "f1", "f2"... in floor order), chunks in base64
 * (stored raw-deflate bytes) by floor uid / layer / "cx:cy", generation. P4 has no fog, objects,
 * notes, links nor placed tokens: empty.
 *
 * Internal documents (version snapshots) also carry the palette asset_id, so that a restore
 * finds the exact asset again on this server.
 *
 * Call inside a transaction when a consistent read matters (snapshots, export).
 */
final class MapDocumentBuilder
{
    public const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;

    public function __construct(private MapRepository $maps, private Db $db)
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
            'fog' => new \stdClass(),
            'objects' => [],
            'notes' => [],
            'links' => [],
            'tokens_placed' => [],
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
