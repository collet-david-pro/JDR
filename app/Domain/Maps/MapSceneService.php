<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\Versions\MapVersionService;
use JDR\Domain\Users\User;

/**
 * P5 reads and resets of a map's scene (etapes/P05 "Contrat d'API P5"), GM / co-GM only
 * (MapPolicy: player 403, others 404):
 * - GET /maps/{id}/fog?floor= -> {floor, chunks: [[cx, cy, base64 raw deflate]]} (cy, cx order);
 * - DELETE /maps/{id}/fog?floor= -> {revision}: every fog chunk of the floor erased, revision + 1;
 * - GET /maps/{id}/objects?floor=&bbox=x1,y1,x2,y2 -> {objects}: objects of the floor whose
 *   bounding box intersects the rectangle (all of the floor without bbox).
 * The floor is required: "required" / "invalid" / "not_found" (floor of another map).
 */
final class MapSceneService
{
    public function __construct(
        private MapRepository $maps,
        private MapSceneRepository $scene,
        private MapPolicy $policy,
        private MapVersionService $versions,
    ) {
    }

    /**
     * @param array<string, mixed> $query
     * @return array{floor: string, chunks: list<array{0: int, 1: int, 2: string}>}
     */
    public function fog(User $user, int $mapId, array $query): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $floorId = $this->floor($map, $query);
        $chunks = array_map(
            static fn (array $c): array => [$c['cx'], $c['cy'], base64_encode($c['data'])],
            $this->scene->fog($map->id, $floorId),
        );

        return ['floor' => (string) $floorId, 'chunks' => $chunks];
    }

    /**
     * @param array<string, mixed> $query
     * @return array{revision: int}
     */
    public function clearFog(User $user, int $mapId, array $query): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $floorId = $this->floor($map, $query);

        return $this->maps->db()->transaction(function () use ($map, $floorId, $user): array {
            $locked = $this->maps->findForUpdate($map->id);
            if ($locked === null || $locked->deletedAt !== null) {
                throw new NotFoundException();
            }
            $this->scene->clearFog($locked->id, $floorId);
            $this->maps->update($locked->id, [], true);
            $revision = $locked->revision + 1;
            $this->versions->afterOps($locked, $revision, $user->id);

            return ['revision' => $revision];
        });
    }

    /**
     * @param array<string, mixed> $query
     * @return array{objects: list<array<string, mixed>>}
     */
    public function objects(User $user, int $mapId, array $query): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $floorId = $this->floor($map, $query);
        $bbox = self::bboxParam($query['bbox'] ?? null);

        return ['objects' => $this->scene->objects($map->id, $floorId, $bbox)];
    }

    /**
     * @param array<string, mixed> $query
     * @throws ValidationException
     */
    private function floor(Map $map, array $query): int
    {
        $raw = $query['floor'] ?? null;
        if ($raw === null || $raw === '') {
            throw new ValidationException('', ['floor' => 'required']);
        }
        $id = Fields::id($raw);
        if ($id === null) {
            throw new ValidationException('', ['floor' => 'invalid']);
        }
        foreach ($this->maps->floors($map->id) as $floor) {
            if ($floor['id'] === $id) {
                return $id;
            }
        }
        throw new ValidationException('', ['floor' => 'not_found']);
    }

    /**
     * "x1,y1,x2,y2" (cells, x1 <= x2, y1 <= y2); null when absent.
     *
     * @return array{0: float, 1: float, 2: float, 3: float}|null
     * @throws ValidationException
     */
    private static function bboxParam(mixed $value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }
        $parts = is_string($value) ? explode(',', $value) : [];
        if (count($parts) !== 4) {
            throw new ValidationException('', ['bbox' => 'invalid']);
        }
        $out = [];
        foreach ($parts as $part) {
            $part = trim($part);
            if (preg_match('/^-?\d{1,6}(\.\d{1,6})?$/D', $part) !== 1) {
                throw new ValidationException('', ['bbox' => 'invalid']);
            }
            $out[] = (float) $part;
        }
        if ($out[0] > $out[2] || $out[1] > $out[3]) {
            throw new ValidationException('', ['bbox' => 'invalid']);
        }

        return [$out[0], $out[1], $out[2], $out[3]];
    }
}
