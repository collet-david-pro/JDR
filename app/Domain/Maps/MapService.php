<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\I18n;
use JDR\Domain\Games\Fields;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Users\User;
use JDR\Maps\ChunkCodec;

/**
 * Maps of a game (contract P4b): list (folders, order, trash), create (one floor "level 0" and
 * the default layers), update, trash / restore, full duplication (floors, chunks, palette,
 * asset references; P5: objects, placed tokens and fog), binary chunk reads. Rights: MapPolicy
 * (GM / co-GM).
 */
final class MapService
{
    public const MAX_CHUNK_KEYS = 1024;

    public function __construct(
        private Db $db,
        private MapRepository $maps,
        private MapPolicy $policy,
        private GamePolicy $games,
        private I18n $i18n,
        private MapSceneRepository $scene,
    ) {
    }

    /**
     * @param array<string, mixed> $query state=active|trash
     * @return list<Map>
     */
    public function list(User $user, int $gameId, array $query): array
    {
        $game = $this->games->requireEdit($user, $gameId);
        $state = $query['state'] ?? 'active';
        if ($state === '') {
            $state = 'active';
        }
        if (!in_array($state, ['active', 'trash'], true)) {
            throw new ValidationException('', ['state' => 'invalid']);
        }

        return $this->maps->listForGame($game->id, $state === 'trash');
    }

    /**
     * @param array<array-key, mixed> $body
     */
    public function create(User $user, int $gameId, array $body): Map
    {
        $game = $this->games->requireEdit($user, $gameId);
        $v = MapInput::create($body, $game->settings);
        $id = (int) $this->db->transaction(function () use ($user, $game, $v): int {
            $id = $this->maps->insert([
                'game_id' => $game->id,
                'owner_user_id' => $user->id,
                'name' => $v['name'],
                'folder' => $v['folder'],
                'sort_order' => $this->maps->nextSortOrder($game->id),
                'kind' => $v['kind'],
                'cell_px' => $v['cell_px'],
                'width' => $v['width'],
                'height' => $v['height'],
                'unit_label' => $v['unit_label'],
                'unit_per_cell' => $v['unit_per_cell'],
                'theme' => $v['theme'],
                'ambient' => MapInput::DEFAULT_AMBIENT,
                'palette' => [null],
                'layers' => MapInput::defaultLayers(),
            ]);
            $this->maps->insertFloor($id, 0, $this->text('maps.default_floor_name', 'Rez-de-chaussée'), 0);

            return $id;
        });

        return $this->maps->find($id) ?? throw new \RuntimeException('Map lost after insert.');
    }

    public function show(User $user, int $mapId): Map
    {
        return $this->policy->requireEdit($user, $mapId)[0];
    }

    /**
     * @param array<array-key, mixed> $body {name?, folder?|null, sort_order?}
     */
    public function update(User $user, int $mapId, array $body): Map
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $changes = MapInput::patch($body);
        if ($changes !== []) {
            $this->maps->update($map->id, $changes);
        }

        return $this->maps->find($map->id) ?? $map;
    }

    /**
     * Soft delete (trash); idempotent on a map already in the trash.
     */
    public function delete(User $user, int $mapId): void
    {
        [$map] = $this->policy->requireEdit($user, $mapId, true);
        $this->maps->softDelete($map->id);
    }

    /**
     * Out of the trash, at the end of the list.
     */
    public function restore(User $user, int $mapId): Map
    {
        [$map, $game] = $this->policy->requireEdit($user, $mapId, true);
        if ($map->deletedAt !== null) {
            $this->maps->restore($map->id, $this->maps->nextSortOrder($game->id));
        }

        return $this->maps->find($map->id) ?? $map;
    }

    /**
     * Full copy (floors, chunks, palette, layers, ambient, asset references, objects, placed
     * tokens, fog; objects and tokens back to rev 1), revision 0,
     * named "<name> (copie)" unless a name is given.
     *
     * @param array<array-key, mixed> $body {name?}
     */
    public function duplicate(User $user, int $mapId, array $body): Map
    {
        [$map, $game] = $this->policy->requireEdit($user, $mapId);
        $errors = [];
        $name = array_key_exists('name', $body) && $body['name'] !== null
            ? MapInput::name($body['name'], 'name', $errors)
            : self::copyName($map->name, $this->text('maps.copy_suffix', ' (copie)'));
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $id = (int) $this->db->transaction(function () use ($user, $game, $map, $name): int {
            // Lock the source: a concurrent lot of ops is applied entirely before or after the copy.
            $source = $this->maps->findForUpdate($map->id);
            if ($source === null || $source->deletedAt !== null) {
                throw new NotFoundException();
            }
            $id = $this->maps->insert([
                'game_id' => $game->id,
                'owner_user_id' => $user->id,
                'name' => (string) $name,
                'folder' => $source->folder,
                'sort_order' => $this->maps->nextSortOrder($game->id),
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
                $floorId = $this->maps->insertFloor($id, $floor['level'], $floor['name'], $floor['sort_order']);
                $this->maps->copyChunks($source->id, $floor['id'], $id, $floorId);
                $this->scene->copyFloor($source->id, $floor['id'], $id, $floorId);
            }
            $this->maps->copyRefs($source->id, $id);

            return $id;
        });

        return $this->maps->find($id) ?? throw new \RuntimeException('Map lost after duplication.');
    }

    /**
     * GET /maps/{id}/chunks: binary body [cx u16 LE][cy u16 LE][layer u8][len u32 LE][data] ...
     * and the map revision, read in one consistent snapshot.
     *
     * @param array<string, mixed> $query floor, layers ("ground,terrain,decor"), cells ("cx:cy,...")
     * @return array{body: string, revision: int}
     */
    public function chunks(User $user, int $mapId, array $query): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $floors = $this->maps->floors($map->id);
        $errors = [];
        $floorId = null;
        $rawFloor = $query['floor'] ?? '';
        if ($rawFloor === '' || $rawFloor === null) {
            $floorId = $floors[0]['id'] ?? null;
        } else {
            $wanted = Fields::id($rawFloor);
            foreach ($floors as $floor) {
                if ($floor['id'] === $wanted) {
                    $floorId = $wanted;
                }
            }
            if ($floorId === null) {
                $errors['floor'] = 'not_found';
            }
        }
        $layers = self::layersParam($query['layers'] ?? null, $errors);
        $cells = self::cellsParam($query['cells'] ?? null, $errors);
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        if ($floorId === null) {
            return ['body' => '', 'revision' => $map->revision];
        }

        return $this->db->transaction(function () use ($map, $floorId, $layers, $cells): array {
            $revision = (int) $this->db->fetchValue('SELECT `revision` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$map->id]);
            $body = '';
            foreach ($this->maps->readChunks($map->id, $floorId, $layers, $cells) as $chunk) {
                $body .= pack('vvCV', $chunk['cx'], $chunk['cy'], ChunkCodec::LAYERS[$chunk['layer']] ?? 0, strlen($chunk['data']))
                    . $chunk['data'];
            }

            return ['body' => $body, 'revision' => $revision];
        });
    }

    /**
     * @param array<string, string> $errors
     * @return list<string>
     */
    private static function layersParam(mixed $value, array &$errors): array
    {
        if ($value === null || $value === '') {
            return MapInput::TILE_LAYERS;
        }
        if (!is_string($value)) {
            $errors['layers'] = 'invalid';

            return [];
        }
        $layers = [];
        foreach (explode(',', $value) as $layer) {
            $layer = trim($layer);
            if (!in_array($layer, MapInput::TILE_LAYERS, true)) {
                $errors['layers'] = 'invalid';

                return [];
            }
            $layers[$layer] = $layer;
        }

        return array_values($layers);
    }

    /**
     * @param array<string, string> $errors
     * @return list<array{0: int, 1: int}>|null null = every chunk
     */
    private static function cellsParam(mixed $value, array &$errors): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_string($value)) {
            $errors['cells'] = 'invalid';

            return null;
        }
        $keys = [];
        $max = (MapInput::GRID_MAX - 1) >> 5;
        foreach (explode(',', $value) as $key) {
            if (preg_match('/^(\d{1,3}):(\d{1,3})$/D', trim($key), $m) !== 1 || (int) $m[1] > $max || (int) $m[2] > $max) {
                $errors['cells'] = 'invalid';

                return null;
            }
            $keys[$m[1] . ':' . $m[2]] = [(int) $m[1], (int) $m[2]];
            if (count($keys) > self::MAX_CHUNK_KEYS) {
                $errors['cells'] = 'too_many';

                return null;
            }
        }

        return array_values($keys);
    }

    private static function copyName(string $name, string $suffix): string
    {
        $room = MapInput::NAME_MAX - mb_strlen($suffix, 'UTF-8');

        return rtrim(mb_substr($name, 0, max(1, $room), 'UTF-8')) . $suffix;
    }

    private function text(string $key, string $fallback): string
    {
        return $this->i18n->has($key) ? $this->i18n->t($key) : $fallback;
    }
}
