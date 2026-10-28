<?php

declare(strict_types=1);

namespace JDR\Domain\Procgen;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Logger;
use JDR\Domain\Assets\AssetImporter;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Assets\TagService;
use JDR\Domain\Settings\Settings;

/**
 * Lazy, idempotent installation of the base pack into the general asset library. No migration:
 * the import goes through the regular pipeline (checks, re-encoding, thumbnail), which needs the
 * services of a request. State: setting `base_pack` = {version, assets: {key: asset id}}.
 */
final class BasePackInstaller
{
    public const SETTING = 'base_pack';
    private const LOCK = 'jdr_base_pack';

    public function __construct(
        private Db $db,
        private Settings $settings,
        private AssetImporter $importer,
        private AssetStorage $storage,
        private BasePackManifest $manifest,
        private Logger $logger,
    ) {
    }

    /**
     * @return array<string, int> pack key => asset id (keys that failed to import are absent)
     */
    public function ensureInstalled(): array
    {
        $version = $this->manifest->version();
        $state = $this->state();
        if ($state['version'] === $version) {
            return $state['assets'];
        }
        $lock = substr(self::LOCK . ':' . $this->db->prefix(), 0, 64);
        if ((int) $this->db->fetchValue('SELECT GET_LOCK(?, 30)', [$lock]) !== 1) {
            return $this->state()['assets'];
        }
        try {
            $this->settings->refresh();
            $state = $this->state();
            if ($state['version'] === $version) {
                return $state['assets'];
            }
            $assets = $this->install();
            $this->settings->set(self::SETTING, ['version' => $version, 'assets' => $assets]);

            return $assets;
        } finally {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
        }
    }

    /**
     * @return array<string, int>
     */
    private function install(): array
    {
        $categories = [];
        $assets = [];
        foreach ($this->manifest->entries() as $entry) {
            $tmp = $this->storage->newTmpPath('.png');
            try {
                if (!copy($this->manifest->directory() . '/' . $entry['file'], $tmp)) {
                    throw new \RuntimeException('Cannot copy ' . $entry['file']);
                }
                $category = $categories[$entry['category']] ??= $this->generalCategory($entry['category']);
                $tags = [];
                foreach ($entry['tags'] as $tag) {
                    $n = TagService::normalize($tag);
                    if ($n !== null) {
                        $tags[$n] = $n;
                    }
                }
                $result = $this->importer->import($tmp, new ImportRequest(null, $entry['name'], $entry['kind'], $category, array_values($tags), 'system'));
                $assets[$entry['key']] = $result->asset->id;
            } catch (\Throwable $e) {
                $this->logger->warning('Base pack entry not installed', ['key' => $entry['key'], 'error' => $e->getMessage()]);
            } finally {
                $this->storage->remove($tmp);
            }
        }

        return $assets;
    }

    private function generalCategory(string $name): ?int
    {
        $id = $this->db->fetchValue(
            'SELECT `id` FROM ' . $this->db->t('asset_categories') . ' WHERE `owner_user_id` IS NULL AND `parent_id` IS NULL AND `name` = ? ORDER BY `id` LIMIT 1',
            [$name],
        );

        return $id === null ? null : (int) $id;
    }

    /**
     * @return array{version: int, assets: array<string, int>}
     */
    private function state(): array
    {
        $raw = $this->settings->get(self::SETTING);
        $assets = [];
        if (is_array($raw) && is_array($raw['assets'] ?? null)) {
            foreach ($raw['assets'] as $key => $id) {
                if (is_int($id)) {
                    $assets[(string) $key] = $id;
                }
            }
        }

        return ['version' => is_array($raw) && is_int($raw['version'] ?? null) ? $raw['version'] : 0, 'assets' => $assets];
    }
}
