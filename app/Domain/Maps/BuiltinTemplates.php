<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Logger;
use JDR\Domain\Procgen\BasePackInstaller;
use JDR\Domain\Settings\Settings;
use JDR\Maps\ChunkCodec;
use JDR\Maps\MapState;
use JDR\Maps\OpsApplier;

/**
 * Lazy, idempotent installation of the built-in map templates (P9c1): templates/manifest.json and
 * one <id>.json per template (made by frontend/scripts/build-templates.ts). No migration; same
 * pattern as BasePackInstaller: setting `builtin_templates` = {version, ids: {template id => map id},
 * deleted: [template id]} and a GET_LOCK.
 *
 * Each file holds the ops of the generator binding (tiles, palette with `pack:<key>` placeholders,
 * walls, doors, windows), a few lights and GM notes. The placeholders are replaced by the asset ids
 * of the base pack (BasePackInstaller::ensureInstalled), then the ops go through the regular
 * OpsApplier (same validation as POST /maps/{id}/ops) without the game policy: a template belongs to
 * no game (game_id NULL), so MapOpsService, which needs one, is not used.
 *
 * A template whose pack key is missing is logged and not installed, and the version is not frozen
 * (next call tries again). A template deleted by an admin stays in `deleted`: not installed again.
 * A new manifest version installs the templates not yet known; installed ones are never rewritten.
 * Owner: the first active admin; scope `site`.
 */
final class BuiltinTemplates
{
    public const SETTING = 'builtin_templates';
    private const LOCK = 'jdr_builtin_templates';
    private const BATCH = MapOpsInput::MAX_OPS;

    public function __construct(
        private Db $db,
        private Settings $settings,
        private Logger $logger,
        private MapRepository $maps,
        private MapSceneRepository $scene,
        private MapFloorRepository $floorRows,
        private MapLinks $links,
        private MapNotes $notes,
        private BasePackInstaller $pack,
        private ?string $dir = null,
    ) {
    }

    /**
     * Installs what is missing. Safe to call on every request: one setting read once installed.
     */
    public function ensureInstalled(): void
    {
        $manifest = $this->manifest();
        if ($manifest === null) {
            return;
        }
        $state = $this->state();
        if ($this->complete($manifest, $state)) {
            return;
        }
        $lock = substr(self::LOCK . ':' . $this->db->prefix(), 0, 64);
        if ((int) $this->db->fetchValue('SELECT GET_LOCK(?, 30)', [$lock]) !== 1) {
            return;
        }
        try {
            $this->settings->refresh();
            $state = $this->state();
            if ($this->complete($manifest, $state)) {
                return;
            }
            $this->install($manifest, $state);
        } finally {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
        }
    }

    /**
     * @return array<int, string> map id => template id of the built-in templates still installed
     */
    public function installed(): array
    {
        $out = [];
        foreach ($this->state()['ids'] as $key => $mapId) {
            $out[$mapId] = $key;
        }

        return $out;
    }

    /**
     * An admin deleted this built-in template: it is not installed again.
     */
    public function forget(int $mapId): void
    {
        $state = $this->state();
        $key = array_search($mapId, $state['ids'], true);
        if ($key === false) {
            return;
        }
        unset($state['ids'][$key]);
        $state['deleted'][] = (string) $key;
        $this->save($state);
    }

    // ---- Internals -------------------------------------------------------------------------

    /**
     * @param array{version: int, templates: list<array{id: string, file: string}>} $manifest
     * @param array{version: int, ids: array<string, int>, deleted: list<string>} $state
     */
    private function install(array $manifest, array $state): void
    {
        $admin = $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('users') . " WHERE `role` = 'admin' AND `status` = 'active' ORDER BY `id` LIMIT 1");
        if ($admin === null) {
            $this->logger->warning('Built-in map templates not installed: no admin account');

            return;
        }
        $failed = false;
        $pack = null;
        foreach ($manifest['templates'] as $entry) {
            $id = $entry['id'];
            if (in_array($id, $state['deleted'], true)) {
                continue;
            }
            if (isset($state['ids'][$id]) && $this->exists($state['ids'][$id])) {
                continue;
            }
            unset($state['ids'][$id]);
            $pack ??= $this->pack->ensureInstalled();
            try {
                $file = $this->read($entry['file']);
                $ops = $this->resolveOps($file['ops'], $pack, $id);
                if ($ops === null) {
                    $failed = true;
                    continue;
                }
                $state['ids'][$id] = $this->create($file, $ops, (int) $admin);
            } catch (\Throwable $e) {
                $failed = true;
                $this->logger->warning('Built-in map template not installed', ['template' => $id, 'error' => $e->getMessage()]);
            }
        }
        if (!$failed) {
            $state['version'] = $manifest['version'];
        }
        $this->save($state);
    }

    /**
     * Replaces `pack:<key>` by the asset id; null (and a warning) when a key has no asset.
     *
     * @param list<array<string, mixed>> $ops
     * @param array<string, int>         $pack
     * @return list<array<string, mixed>>|null
     */
    private function resolveOps(array $ops, array $pack, string $template): ?array
    {
        foreach ($ops as $i => $op) {
            if (($op['type'] ?? null) !== 'palette.add') {
                continue;
            }
            $ref = (string) ($op['asset_id'] ?? '');
            $key = str_starts_with($ref, 'pack:') ? substr($ref, 5) : $ref;
            if (!isset($pack[$key])) {
                $this->logger->warning('Built-in map template not installed: pack key missing', ['template' => $template, 'key' => $key]);

                return null;
            }
            $ops[$i]['asset_id'] = $pack[$key];
        }

        return $ops;
    }

    /**
     * @param array<string, mixed>       $file
     * @param list<array<string, mixed>> $ops
     */
    private function create(array $file, array $ops, int $ownerId): int
    {
        return (int) $this->db->transaction(function () use ($file, $ops, $ownerId): int {
            $id = $this->maps->insert([
                'game_id' => null,
                'owner_user_id' => $ownerId,
                'name' => (string) $file['name'],
                'folder' => null,
                'sort_order' => 0,
                'kind' => (string) ($file['kind'] ?? 'battle'),
                'cell_px' => (int) $file['cell_px'],
                'width' => (int) $file['width'],
                'height' => (int) $file['height'],
                'unit_label' => (string) $file['unit_label'],
                'unit_per_cell' => $file['unit_per_cell'],
                'theme' => (string) $file['theme'],
                'ambient' => MapInput::DEFAULT_AMBIENT,
                'palette' => [null],
                'layers' => MapInput::defaultLayers(),
            ]);
            $this->maps->insertFloor($id, (string) $file['floor'], 0, (string) ($file['floor_name'] ?? 'Niveau 0'), 0);
            $this->maps->markTemplate($id, 'site');
            foreach (array_chunk($ops, self::BATCH) as $batch) {
                $this->applyBatch($id, $batch);
            }

            return $id;
        });
    }

    /**
     * One lot of ops on the map, like MapOpsService but with no game, user, version, nor broadcast.
     *
     * @param list<array<string, mixed>> $raw
     */
    private function applyBatch(int $mapId, array $raw): void
    {
        $map = $this->maps->findForUpdate($mapId) ?? throw new \RuntimeException('Template map lost.');
        $ops = MapOpsInput::ops($raw);
        $state = new MapState(
            $map->revision, $map->name, $map->width, $map->height, $map->cellPx, $map->unitLabel, $map->unitPerCell,
            $map->theme, $map->ambient, $map->palette, $map->layers, $this->maps->floors($mapId),
        );
        $known = $this->maps->existingAssetIds($this->paletteIds($ops));
        $applier = new OpsApplier(
            $state,
            new MapChunkStore($this->maps, $mapId, $this->floorRows),
            static fn (int $assetId): bool => isset($known[$assetId]),
            new MapSceneStore($this->scene, $mapId, 0, $this->links),
            new MapFloorStore($this->maps, $this->floorRows, $mapId),
            new MapNotesOps($this->notes, $this->maps, $this->scene, $state, $mapId, 0, static fn (int $assetId): bool => isset($known[$assetId])),
        );
        $applied = $applier->apply($ops, $map->revision);
        if ($applier->conflicts() !== [] || $applied !== count($ops)) {
            throw new \RuntimeException('Template ops refused or in conflict.');
        }
        $revision = $map->revision + 1;
        foreach ($applier->dirtyChunks() as $chunk) {
            if (ChunkCodec::isEmpty($chunk->raw)) {
                if ($chunk->existed) {
                    $this->maps->deleteChunk($mapId, $chunk->floorId, $chunk->layer, $chunk->cx, $chunk->cy);
                }
                continue;
            }
            $data = ChunkCodec::compress($chunk->raw);
            $chunk->existed
                ? $this->maps->updateChunk($mapId, $chunk->floorId, $chunk->layer, $chunk->cx, $chunk->cy, $data, $revision)
                : $this->maps->insertChunk($mapId, $chunk->floorId, $chunk->layer, $chunk->cx, $chunk->cy, $data, $revision);
        }
        $this->maps->applyRefDeltas($mapId, $applier->refDeltas());
        $this->maps->update($mapId, $state->changedColumns(), true);
    }

    /**
     * @param list<array<string, mixed>> $ops normalized
     * @return list<int>
     */
    private function paletteIds(array $ops): array
    {
        $ids = [];
        foreach ($ops as $op) {
            if ($op['type'] === 'palette.add') {
                $ids[] = (int) $op['asset_id'];
            }
        }

        return $ids;
    }

    private function exists(int $mapId): bool
    {
        return $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('maps') . ' WHERE `id` = ? AND `is_template` = 1', [$mapId]) !== null;
    }

    /**
     * @param array{version: int, templates: list<array{id: string, file: string}>} $manifest
     * @param array{version: int, ids: array<string, int>, deleted: list<string>} $state
     */
    private function complete(array $manifest, array $state): bool
    {
        if ($state['version'] !== $manifest['version']) {
            return false;
        }
        foreach ($manifest['templates'] as $entry) {
            if (!isset($state['ids'][$entry['id']]) && !in_array($entry['id'], $state['deleted'], true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return array{version: int, templates: list<array{id: string, file: string}>}|null
     */
    private function manifest(): ?array
    {
        $raw = @file_get_contents($this->directory() . '/manifest.json');
        $data = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($data) || !is_int($data['version'] ?? null) || !is_array($data['templates'] ?? null)) {
            $this->logger->warning('Built-in map templates: manifest missing or invalid');

            return null;
        }
        $templates = [];
        foreach ($data['templates'] as $t) {
            if (is_array($t) && is_string($t['id'] ?? null) && is_string($t['file'] ?? null) && preg_match('/^[a-z0-9_-]+\.json$/D', $t['file']) === 1) {
                $templates[] = ['id' => $t['id'], 'file' => $t['file']];
            }
        }

        return ['version' => $data['version'], 'templates' => $templates];
    }

    /**
     * @return array<string, mixed>
     */
    private function read(string $file): array
    {
        $raw = file_get_contents($this->directory() . '/' . $file);
        $data = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($data) || !is_array($data['ops'] ?? null) || !is_string($data['name'] ?? null)) {
            throw new \RuntimeException('Invalid template file ' . $file);
        }

        return $data;
    }

    private function directory(): string
    {
        return $this->dir ?? __DIR__ . '/templates';
    }

    /**
     * @return array{version: int, ids: array<string, int>, deleted: list<string>}
     */
    private function state(): array
    {
        $raw = $this->settings->get(self::SETTING);
        $ids = [];
        $deleted = [];
        if (is_array($raw)) {
            foreach (is_array($raw['ids'] ?? null) ? $raw['ids'] : [] as $key => $mapId) {
                if (is_int($mapId)) {
                    $ids[(string) $key] = $mapId;
                }
            }
            foreach (is_array($raw['deleted'] ?? null) ? $raw['deleted'] : [] as $key) {
                if (is_string($key)) {
                    $deleted[] = $key;
                }
            }
        }

        return ['version' => is_array($raw) && is_int($raw['version'] ?? null) ? $raw['version'] : 0, 'ids' => $ids, 'deleted' => array_values(array_unique($deleted))];
    }

    /**
     * @param array{version: int, ids: array<string, int>, deleted: list<string>} $state
     */
    private function save(array $state): void
    {
        $this->settings->set(self::SETTING, $state);
    }
}
