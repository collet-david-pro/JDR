<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Users\User;

/**
 * Map templates (P9c1): a map saved apart from any game (game_id NULL, is_template = 1,
 * template_scope private | site) and new maps created from one. Closed to MapPolicy::requireEdit
 * (404 on game_id NULL): the editor and the sessions never open a template.
 *
 * The copy (map => template and template => map) leaves behind what belongs to one table:
 * placed tokens, fog, the audience of the notes (back to the GM alone), the revealed state of
 * traps and secrets, and the links to another map (a portal without link is dropped, it would be
 * invalid). Floors, tiles, objects, palette, notes and asset references are kept. A `site`
 * template may not use a private asset: another GM could not see it (422 scope = private_assets).
 */
final class MapTemplates
{
    public const SCOPES = ['private', 'site'];

    public function __construct(
        private Db $db,
        private MapRepository $maps,
        private MapPolicy $policy,
        private GamePolicy $games,
        private MapSceneRepository $scene,
        private MapLinks $links,
        private MapNotes $notes,
        private BuiltinTemplates $builtin,
    ) {
    }

    /**
     * Built-in and `site` templates, then the user's private ones.
     *
     * @return list<array<string, mixed>>
     */
    public function list(User $user): array
    {
        $this->builtin->ensureInstalled();
        $rows = $this->db->fetchAll(
            'SELECT m.*, (SELECT COUNT(*) FROM ' . $this->db->t('map_floors') . ' f WHERE f.`map_id` = m.`id`) AS floors, '
            . '(SELECT COUNT(*) FROM ' . $this->db->t('map_notes') . ' n WHERE n.`map_id` = m.`id`) AS notes FROM ' . $this->db->t('maps') . ' m '
            . "WHERE m.`is_template` = 1 AND m.`deleted_at` IS NULL AND (m.`template_scope` = 'site' OR (m.`template_scope` = 'private' AND m.`owner_user_id` = ?)) "
            . "ORDER BY (m.`template_scope` = 'site') DESC, m.`name`, m.`id`",
            [$user->id],
        );
        $builtin = $this->builtin->installed();

        return array_map(fn (array $r): array => $this->present($user, $r, $builtin), $rows);
    }

    /**
     * @param array<array-key, mixed> $body {name, scope}
     * @return array<string, mixed>
     */
    public function saveAs(User $user, int $mapId, array $body): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $errors = [];
        $name = MapInput::name($body['name'] ?? null, 'name', $errors);
        $scope = $body['scope'] ?? 'private';
        if (!is_string($scope) || !in_array($scope, self::SCOPES, true)) {
            $errors['scope'] = 'invalid';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        if ($scope === 'site' && !$user->isAdmin()) {
            throw new ForbiddenException();
        }
        $id = (int) $this->db->transaction(function () use ($user, $map, $name, $scope): int {
            $source = $this->maps->findForUpdate($map->id);
            if ($source === null || $source->deletedAt !== null) {
                throw new NotFoundException();
            }
            if ($scope === 'site' && $this->privateAssets($source) !== []) {
                throw new ValidationException('', ['scope' => 'private_assets']);
            }
            $id = $this->copyMap($source, null, $user->id, (string) $name, null);
            $this->maps->markTemplate($id, (string) $scope);

            return $id;
        });

        return $this->row($user, $id);
    }

    /**
     * @param array<array-key, mixed> $body {game_id, name?}
     */
    public function instantiate(User $user, int $templateId, array $body): Map
    {
        $errors = [];
        $gameId = Fields::int($body['game_id'] ?? null, 1, PHP_INT_MAX);
        if ($gameId === null) {
            $errors['game_id'] = array_key_exists('game_id', $body) ? 'invalid' : 'required';
        }
        $name = array_key_exists('name', $body) && $body['name'] !== null && $body['name'] !== ''
            ? MapInput::name($body['name'], 'name', $errors)
            : null;
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $game = $this->games->requireEdit($user, (int) $gameId);
        $this->requireVisible($user, $templateId);
        $id = (int) $this->db->transaction(function () use ($user, $game, $templateId, $name): int {
            $source = $this->maps->findForUpdate($templateId);
            if ($source === null || !$this->isVisible($user, $source->id)) {
                throw new NotFoundException();
            }

            return $this->copyMap($source, $game->id, $user->id, $name ?? $source->name, $this->maps->nextSortOrder($game->id));
        });

        return $this->maps->find($id) ?? throw new \RuntimeException('Map lost after instantiation.');
    }

    public function delete(User $user, int $templateId): void
    {
        $this->db->transaction(function () use ($user, $templateId): void {
            $row = $this->db->fetchOne(
                'SELECT `id`, `owner_user_id`, `template_scope` FROM ' . $this->db->t('maps') . ' WHERE `id` = ? AND `is_template` = 1 FOR UPDATE',
                [$templateId],
            );
            if ($row === null || !$this->visibleRow($user, $row)) {
                throw new NotFoundException();
            }
            if (!$this->canDelete($user, $row)) {
                throw new ForbiddenException();
            }
            $this->builtin->forget($templateId);
            $this->maps->hardDelete($templateId);
        });
    }

    // ---- Internals -------------------------------------------------------------------------

    /**
     * Copies a locked map (template or not) as a new map: $gameId null = a template row (to be marked
     * by the caller), else a map of that game at $sortOrder.
     */
    private function copyMap(Map $source, ?int $gameId, int $ownerId, string $name, ?int $sortOrder): int
    {
        $id = $this->maps->insert([
            'game_id' => $gameId,
            'owner_user_id' => $ownerId,
            'name' => $name,
            'folder' => null,
            'sort_order' => $sortOrder ?? 0,
            'kind' => $source->kind,
            'cell_px' => $source->cellPx,
            'width' => $source->width,
            'height' => $source->height,
            'unit_label' => $source->unitLabel,
            'unit_per_cell' => $source->unitPerCell,
            'theme' => $source->theme,
            'ambient' => $source->ambient,
            'palette' => $source->palette,
            'layers' => $source->layers,
        ]);
        foreach ($this->maps->floors($source->id) as $floor) {
            $floorId = $this->maps->insertFloor($id, $floor['uid'], $floor['level'], $floor['name'], $floor['sort_order']);
            $this->maps->copyChunks($source->id, $floor['id'], $id, $floorId);
            $this->scene->copyFloor($source->id, $floor['id'], $id, $floorId, false);
        }
        $this->maps->copyRefs($source->id, $id);
        $this->dropForeignLinks($source->id, $id);
        $this->links->rebuildMap($id);
        $this->notes->copy($source->id, $id, true);

        return $id;
    }

    /**
     * Links to another map leave the copy (a link to the source map itself is turned to the copy);
     * stairs between floors of the same map (props.to_floor) are kept.
     */
    private function dropForeignLinks(int $sourceId, int $mapId): void
    {
        $o = $this->db->t('map_objects');
        $rows = $this->db->fetchAll(
            'SELECT `id`, `type`, `props` FROM ' . $o . " WHERE `map_id` = ? AND `type` IN ('door', 'stairs', 'portal') AND `props` LIKE '%\"link\"%'",
            [$mapId],
        );
        foreach ($rows as $row) {
            $props = json_decode((string) $row['props'], true);
            $link = is_array($props) && is_array($props['link'] ?? null) ? $props['link'] : null;
            if ($link === null) {
                continue;
            }
            if ((int) ($link['map_id'] ?? 0) === $sourceId) {
                $props['link']['map_id'] = $mapId;
            } elseif ($row['type'] === 'portal') {
                $this->db->execute('DELETE FROM ' . $o . ' WHERE `id` = ?', [(int) $row['id']]);
                continue;
            } else {
                unset($props['link']);
            }
            $this->db->execute('UPDATE ' . $o . ' SET `props` = ? WHERE `id` = ?', [json_encode($props, MapRepository::JSON_FLAGS), (int) $row['id']]);
        }
    }

    /**
     * Ids of the private assets (owned by an account) used by the palette, the notes or the references.
     *
     * @return list<int>
     */
    private function privateAssets(Map $map): array
    {
        $ids = [];
        foreach ($map->palette as $entry) {
            if ($entry !== null) {
                $ids[$entry['asset_id']] = $entry['asset_id'];
            }
        }
        foreach ($this->notes->assetIds($map->id, null) as $assetId) {
            $ids[$assetId] = $assetId;
        }
        foreach ($this->db->fetchAll('SELECT `asset_id` FROM ' . $this->db->t('map_asset_refs') . ' WHERE `map_id` = ?', [$map->id]) as $r) {
            $ids[(int) $r['asset_id']] = (int) $r['asset_id'];
        }
        $private = [];
        foreach (array_chunk(array_values($ids), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id` FROM ' . $this->db->t('assets') . ' WHERE `owner_user_id` IS NOT NULL AND `id` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                $batch,
            );
            foreach ($rows as $r) {
                $private[] = (int) $r['id'];
            }
        }

        return $private;
    }

    /**
     * @param array<string, mixed> $row maps row
     */
    private function visibleRow(User $user, array $row): bool
    {
        return $row['template_scope'] === 'site' || ($row['template_scope'] === 'private' && (int) $row['owner_user_id'] === $user->id);
    }

    /**
     * @param array<string, mixed> $row maps row
     */
    private function canDelete(User $user, array $row): bool
    {
        return $row['template_scope'] === 'site' ? $user->isAdmin() : (int) $row['owner_user_id'] === $user->id;
    }

    private function isVisible(User $user, int $id): bool
    {
        $row = $this->db->fetchOne(
            'SELECT `owner_user_id`, `template_scope` FROM ' . $this->db->t('maps') . ' WHERE `id` = ? AND `is_template` = 1 AND `deleted_at` IS NULL',
            [$id],
        );

        return $row !== null && $this->visibleRow($user, $row);
    }

    private function requireVisible(User $user, int $id): void
    {
        if (!$this->isVisible($user, $id)) {
            throw new NotFoundException();
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function row(User $user, int $id): array
    {
        foreach ($this->list($user) as $row) {
            if ($row['id'] === $id) {
                return $row;
            }
        }

        throw new \RuntimeException('Template lost after save.');
    }

    /**
     * @param array<string, mixed> $r
     * @param array<int, string>   $builtin
     * @return array<string, mixed>
     */
    private function present(User $user, array $r, array $builtin): array
    {
        return [
            'id' => (int) $r['id'],
            'name' => (string) $r['name'],
            'scope' => (string) $r['template_scope'],
            'builtin' => isset($builtin[(int) $r['id']]),
            'kind' => (string) $r['kind'],
            'width' => (int) $r['width_cells'],
            'height' => (int) $r['height_cells'],
            'floors' => (int) $r['floors'],
            'notes' => (int) $r['notes'],
            'owned' => (int) $r['owner_user_id'] === $user->id,
            'can_delete' => $this->canDelete($user, $r),
        ];
    }
}
