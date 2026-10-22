<?php

declare(strict_types=1);

namespace JDR\Domain\Maps\Transfer;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\FileServer;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapPolicy;
use JDR\Domain\Users\User;
use JDR\Maps\Document\MapDocumentBuilder;
use JDR\Zip\ZipWriter;

/**
 * GET /maps/{id}/export?assets=0|1 (contract P4c): the map document (projet.md 12.1, asset
 * references "sha256:<hex>"), alone (JSON) or in a ZIP {map.json, assets/<sha256>.<ext>} holding
 * the files of the live palette assets (one file per content). Read in one transaction
 * (consistent with concurrent ops). The ZIP is written in storage/tmp and deleted after the
 * response (or by the tmp purge).
 */
final class MapExportService
{
    public const DOCUMENT_NAME = 'map.json';
    public const ASSETS_DIR = 'assets/';

    public function __construct(
        private Db $db,
        private MapPolicy $policy,
        private MapDocumentBuilder $builder,
        private AssetStorage $storage,
    ) {
    }

    /**
     * @return array{json: string, file_name: string}
     */
    public function json(User $user, int $mapId): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $doc = $this->db->transaction(fn (): array => $this->builder->build($map));

        return ['json' => MapDocumentBuilder::encode($doc, true), 'file_name' => self::fileName($map, 'json')];
    }

    /**
     * @return array{path: string, file_name: string}
     */
    public function zip(User $user, int $mapId): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        [$doc, $assets] = $this->db->transaction(fn (): array => [$this->builder->build($map), $this->builder->paletteAssets($map)]);
        $path = $this->storage->newTmpPath('.zip');
        try {
            $writer = ZipWriter::create($path);
            try {
                $writer->addString(self::DOCUMENT_NAME, MapDocumentBuilder::encode($doc, true));
                $done = [];
                foreach ($assets as $asset) {
                    $file = $this->storage->path($asset['uuid'], $asset['ext']);
                    if ($asset['deleted'] || isset($done[$asset['sha256']]) || !is_file($file)) {
                        continue;
                    }
                    $done[$asset['sha256']] = true;
                    $writer->addFile(self::ASSETS_DIR . $asset['sha256'] . '.' . $asset['ext'], $file);
                }
                $writer->finish();
            } finally {
                $writer->close();
            }
        } catch (\Throwable $e) {
            @unlink($path);
            throw $e;
        }

        return ['path' => $path, 'file_name' => self::fileName($map, 'zip')];
    }

    private static function fileName(Map $map, string $ext): string
    {
        return FileServer::fileName($map->name) . '.' . $ext;
    }
}
