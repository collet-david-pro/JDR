<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Sessions\SessionContext;

/**
 * The current map of a session while a batch of actions is applied (map row locked): the placed
 * tokens and objects named by the actions, with their row ids, and the checks that depend on the
 * map, all made before anything is applied (contract P6 "Actions de séance"):
 * - 422 actions.<i>.<key>: coordinates outside the map, unknown floor, unknown uid (GM), wrong
 *   object type, ambient patch, fog block outside the map;
 * - 403 for a player: a token that is not his (not assigned to him, hidden, unknown: no
 *   existence oracle) or players_can_move_own_tokens off.
 * The entries are updated in place by ActionHandlers (several actions on the same uid).
 */
final class ActionScene
{
    /** @var array<string, array{id: int, token: array<string, mixed>}> */
    public array $tokens = [];
    /** @var array<string, array{id: int, object: array<string, mixed>}> */
    public array $objects = [];
    /** @var array<int, array{size_w: float, size_h: float, vision: array<string, mixed>}> token definition id => */
    public array $definitions = [];
    /** @var array<string, mixed> */
    public array $ambient;
    /** @var list<int> */
    public array $floorIds;

    /**
     * @param list<array<string, mixed>> $floors MapRepository::floors()
     * @param array<int, int>            $assignments token definition id => user id
     */
    public function __construct(
        public readonly SessionContext $ctx,
        public readonly Map $map,
        array $floors,
        public readonly int $userId,
        public readonly array $assignments,
        private MapSceneRepository $scene,
        private Db $db,
    ) {
        $this->ambient = $map->ambient;
        $this->floorIds = array_map(static fn (array $f): int => (int) $f['id'], $floors);
    }

    /**
     * Loads what the actions name and checks them against the map and the rights.
     *
     * @param list<array<string, mixed>> $actions ActionInput::parse()
     * @throws ValidationException|ForbiddenException
     */
    public function resolve(array $actions): void
    {
        $tokenUids = [];
        $objectUids = [];
        foreach ($actions as $a) {
            if ($a['type'] === 'token.move' || ($a['type'] === 'reveal' && $a['kind'] === 'token')) {
                $tokenUids[] = $a['uid'];
            } elseif (isset($a['uid'])) {
                $objectUids[] = $a['uid'];
            }
        }
        foreach ($tokenUids === [] ? [] : $this->scene->tokensByUid($this->map->id, $tokenUids) as $row) {
            $this->tokens[(string) $row['token']['uid']] = $row;
        }
        foreach ($objectUids === [] ? [] : $this->scene->objectsByUid($this->map->id, $objectUids) as $row) {
            $this->objects[(string) $row['object']['uid']] = $row;
        }
        $this->loadDefinitions();

        $errors = [];
        foreach ($actions as $i => $a) {
            $this->check($a, 'actions.' . $i, $errors);
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
    }

    public function isGm(): bool
    {
        return $this->ctx->isGm();
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     */
    private function check(array $a, string $field, array &$errors): void
    {
        switch ($a['type']) {
            case 'token.move':
                $entry = $this->tokens[$a['uid']] ?? null;
                if (!$this->isGm()) {
                    $token = $entry['token'] ?? null;
                    $mine = $token !== null && ($this->assignments[(int) $token['token_id']] ?? null) === $this->userId
                        && $token['hidden'] !== true && $this->ctx->setting('players_can_move_own_tokens');
                    if (!$mine) {
                        throw new ForbiddenException();
                    }
                } elseif ($entry === null) {
                    $errors[$field . '.uid'] = 'not_found';
                }
                $this->bounds($a, $field, $errors);
                break;
            case 'reveal':
                if ($a['kind'] === 'token' ? !isset($this->tokens[$a['uid']]) : !isset($this->objects[$a['uid']])) {
                    $errors[$field . '.uid'] = 'not_found';
                }
                break;
            case 'door.toggle':
            case 'light.toggle':
                $object = $this->objects[$a['uid']]['object'] ?? null;
                if ($object === null) {
                    $errors[$field . '.uid'] = 'not_found';
                } elseif ($object['type'] !== ($a['type'] === 'door.toggle' ? 'door' : 'light')) {
                    $errors[$field . '.uid'] = 'invalid';
                }
                break;
            case 'fog.reveal':
            case 'fog.hide':
                if (!in_array($a['floor'], $this->floorIds, true)) {
                    $errors[$field . '.floor'] = 'not_found';
                }
                foreach ($a['chunks'] as $j => [$cx, $cy]) {
                    if ($cx * 32 >= $this->map->width || $cy * 32 >= $this->map->height) {
                        $errors[$field . '.chunks.' . $j] = 'invalid';
                        break;
                    }
                }
                break;
            case 'camera.set':
                if ($a['floor_id'] !== null && !in_array($a['floor_id'], $this->floorIds, true)) {
                    $errors[$field . '.floor_id'] = 'not_found';
                }
                $this->bounds($a, $field, $errors);
                break;
            case 'ambient.set':
                $sub = [];
                $merged = MapInput::ambient($a['ambient'], $this->ambient, $field . '.ambient', $sub);
                $errors += $sub;
                if ($merged === null && $sub === []) {
                    $errors[$field . '.ambient'] = 'invalid';
                }
                break;
        }
    }

    /**
     * x <= width, y <= height of the map.
     *
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     */
    private function bounds(array $a, string $field, array &$errors): void
    {
        if ($a['x'] > $this->map->width) {
            $errors[$field . '.x'] = 'too_large';
        }
        if ($a['y'] > $this->map->height) {
            $errors[$field . '.y'] = 'too_large';
        }
    }

    private function loadDefinitions(): void
    {
        $ids = array_values(array_unique(array_map(static fn (array $e): int => (int) $e['token']['token_id'], $this->tokens)));
        if ($ids === []) {
            return;
        }
        $rows = $this->db->fetchAll(
            'SELECT `id`, `size_w`, `size_h`, `vision` FROM ' . $this->db->t('tokens') . ' WHERE `id` IN ('
            . implode(', ', array_fill(0, count($ids), '?')) . ')',
            $ids,
        );
        foreach ($rows as $r) {
            $vision = json_decode((string) $r['vision'], true);
            $this->definitions[(int) $r['id']] = [
                'size_w' => (float) $r['size_w'],
                'size_h' => (float) $r['size_h'],
                'vision' => is_array($vision) ? $vision : [],
            ];
        }
    }
}
