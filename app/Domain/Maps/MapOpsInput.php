<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Maps\FogCodec;
use JDR\Maps\ObjectRules;
use JDR\Maps\TokenRules;

/**
 * Stateless validation of POST /maps/{id}/ops (projet.md 11.4, contract P4b):
 * {base_revision >= 0, client_op_id (1-40 of [A-Za-z0-9._:-]), ops: [...] (<= 200)}.
 * P4b ops (unknown keys refused):
 * - tiles.set {floor: id, layer: ground|terrain|decor, cells: [[x, y, index, variant, flags], ...] (<= 5 000)}
 *   x, y 0-399, index 0-65535, variant 0-255, flags 0-15 (bits 4-7 reserved); index 0 = erase
 *   (variant/flags forced to 0);
 * - palette.add {index 1-4095, asset_id, autotile?: null | identifier};
 * - map.meta {name?, grid?: {width?, height?, cell_px?, unit_label?, unit_per_cell?}, layers?, theme?, ambient?}.
 * P5 ops (etapes/P05 "Contrat d'API P5"; rules in ObjectRules / TokenRules):
 * - object.add {object: {uid, floor, type, layer, geometry, props, visibility, locked, sort_order, rev?}};
 * - object.update {uid, rev, patch: {geometry?, props?, visibility?, layer?, locked?, sort_order?}}
 *   (geometry / props are checked against the stored type by SceneApplier);
 * - object.remove {uid}; maptoken.add {token: {uid, floor, token_id, x, y, rotation, scale, hidden,
 *   light_override, rev?}}; maptoken.update {uid, rev, patch}; maptoken.remove {uid};
 * - fog.reveal / fog.hide {floor, chunks: [[cx, cy, base64 raw deflate of 2 048 bytes], ...] (<= 200)}.
 * Coordinates are checked here against the largest grid (400), against the map by SceneApplier.
 * What depends on the map (map size, palette, floors, assets, tokens) is checked by OpsApplier.
 * Field errors: "ops" (required | invalid | too_many), "ops.<i>" / "ops.<i>.<key>[.<sub>]".
 */
final class MapOpsInput
{
    public const MAX_OPS = 200;
    public const MAX_CELLS = 5000;
    public const MAX_PALETTE = 4096;
    public const CLIENT_OP_ID_PATTERN = '/^[A-Za-z0-9._:-]{1,40}$/D';
    public const MAX_FOG_CHUNKS = 200;
    public const SCENE_OPS = ['object.add', 'object.update', 'object.remove', 'maptoken.add', 'maptoken.update', 'maptoken.remove', 'fog.reveal', 'fog.hide'];

    private const KEYS = [
        'tiles.set' => ['type', 'floor', 'layer', 'cells'],
        'palette.add' => ['type', 'index', 'asset_id', 'autotile'],
        'map.meta' => ['type', 'name', 'grid', 'layers', 'theme', 'ambient'],
        'object.add' => ['type', 'object'],
        'object.update' => ['type', 'uid', 'rev', 'patch'],
        'object.remove' => ['type', 'uid'],
        'maptoken.add' => ['type', 'token'],
        'maptoken.update' => ['type', 'uid', 'rev', 'patch'],
        'maptoken.remove' => ['type', 'uid'],
        'fog.reveal' => ['type', 'floor', 'chunks'],
        'fog.hide' => ['type', 'floor', 'chunks'],
    ];

    /**
     * @param array<array-key, mixed> $body
     * @return array{base_revision: int, client_op_id: string, ops: mixed}
     * @throws ValidationException
     */
    public static function envelope(array $body): array
    {
        $errors = [];
        $base = $body['base_revision'] ?? null;
        $base = Fields::int($base, 0, PHP_INT_MAX);
        if ($base === null) {
            $errors['base_revision'] = array_key_exists('base_revision', $body) ? 'invalid' : 'required';
        }
        $id = $body['client_op_id'] ?? null;
        if (!is_string($id) || preg_match(self::CLIENT_OP_ID_PATTERN, $id) !== 1) {
            $errors['client_op_id'] = $id === null || $id === '' ? 'required' : 'invalid';
        }
        if (!array_key_exists('ops', $body)) {
            $errors['ops'] = 'required';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return ['base_revision' => (int) $base, 'client_op_id' => (string) $id, 'ops' => $body['ops']];
    }

    /**
     * @return list<array<string, mixed>> normalized ops
     * @throws ValidationException
     */
    public static function ops(mixed $ops): array
    {
        if (!is_array($ops) || !array_is_list($ops)) {
            throw new ValidationException('', ['ops' => 'invalid']);
        }
        if (count($ops) > self::MAX_OPS) {
            throw new ValidationException('', ['ops' => 'too_many']);
        }
        $errors = [];
        $out = [];
        foreach ($ops as $i => $op) {
            $field = 'ops.' . $i;
            $type = is_array($op) ? ($op['type'] ?? null) : null;
            if (!is_string($type) || !isset(self::KEYS[$type])) {
                $errors[$field . '.type'] = 'invalid';
                continue;
            }
            $op = Fields::object($op, self::KEYS[$type]);
            if ($op === null) {
                $errors[$field] = 'invalid';
                continue;
            }
            $parsed = match ($type) {
                'tiles.set' => self::tiles($op, $field, $errors),
                'palette.add' => self::palette($op, $field, $errors),
                'map.meta' => self::meta($op, $field, $errors),
                'object.add' => self::objectAdd($op, $field, $errors),
                'maptoken.add' => self::tokenAdd($op, $field, $errors),
                'object.update', 'maptoken.update' => self::update($op, $field, $errors),
                'object.remove', 'maptoken.remove' => self::remove($op, $field, $errors),
                default => self::fog($op, $field, $errors),
            };
            if ($parsed !== null) {
                $out[] = $parsed;
            }
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $out;
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function tiles(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        $floor = Fields::id($op['floor'] ?? null);
        if ($floor === null) {
            $errors[$field . '.floor'] = array_key_exists('floor', $op) ? 'invalid' : 'required';
        }
        $layer = $op['layer'] ?? null;
        if (!is_string($layer) || !in_array($layer, MapInput::TILE_LAYERS, true)) {
            $errors[$field . '.layer'] = array_key_exists('layer', $op) ? 'invalid' : 'required';
        }
        $cells = $op['cells'] ?? null;
        if (!is_array($cells) || !array_is_list($cells)) {
            $errors[$field . '.cells'] = $cells === null ? 'required' : 'invalid';
        } elseif (count($cells) > self::MAX_CELLS) {
            $errors[$field . '.cells'] = 'too_many';
        } else {
            $max = MapInput::GRID_MAX - 1;
            foreach ($cells as $j => $cell) {
                if (!is_array($cell) || !array_is_list($cell) || count($cell) !== 5) {
                    $errors[$field . '.cells.' . $j] = 'invalid';
                    break;
                }
                [$x, $y, $index, $variant, $flags] = $cell;
                if (!is_int($x) || !is_int($y) || !is_int($index) || !is_int($variant) || !is_int($flags)
                    || $index < 0 || $index > 0xffff || $variant < 0 || $variant > 0xff || $flags < 0 || $flags > 0x0f) {
                    $errors[$field . '.cells.' . $j] = 'invalid';
                    break;
                }
                if ($x < 0 || $y < 0 || $x > $max || $y > $max) {
                    $errors[$field . '.cells.' . $j] = 'out_of_bounds';
                    break;
                }
                if ($index === 0) {
                    $cells[$j] = [$x, $y, 0, 0, 0];
                }
            }
        }

        return count($errors) === $before
            ? ['type' => 'tiles.set', 'floor' => $floor, 'layer' => $layer, 'cells' => $cells]
            : null;
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function palette(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        $index = Fields::int($op['index'] ?? null, 1, self::MAX_PALETTE - 1);
        if ($index === null) {
            $errors[$field . '.index'] = array_key_exists('index', $op) ? 'palette_index' : 'required';
        }
        $assetId = Fields::id($op['asset_id'] ?? null);
        if ($assetId === null) {
            $errors[$field . '.asset_id'] = array_key_exists('asset_id', $op) ? 'invalid' : 'required';
        }
        $autotile = MapInput::autotile($op['autotile'] ?? null);
        if ($autotile === false) {
            $errors[$field . '.autotile'] = 'invalid';
        }

        return count($errors) === $before
            ? ['type' => 'palette.add', 'index' => $index, 'asset_id' => $assetId, 'autotile' => $autotile]
            : null;
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function meta(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        $out = ['type' => 'map.meta'];
        if (array_key_exists('name', $op)) {
            $out['name'] = MapInput::name($op['name'], $field . '.name', $errors);
        }
        if (array_key_exists('grid', $op)) {
            $grid = Fields::object($op['grid'], ['width', 'height', 'cell_px', 'unit_label', 'unit_per_cell']);
            if ($grid === null) {
                $errors[$field . '.grid'] = 'invalid';
            } else {
                $out['grid'] = MapInput::grid($grid, $field . '.grid.', $errors);
            }
        }
        if (array_key_exists('layers', $op)) {
            $out['layers'] = MapInput::layers($op['layers'], $field . '.layers', $errors);
        }
        if (array_key_exists('theme', $op)) {
            $out['theme'] = MapInput::theme($op['theme'], $field . '.theme', $errors);
        }
        if (array_key_exists('ambient', $op)) {
            // Checked against the defaults now, merged over the current ambient when applied.
            if (MapInput::ambient($op['ambient'], MapInput::DEFAULT_AMBIENT, $field . '.ambient', $errors) !== null) {
                $out['ambient'] = $op['ambient'];
            }
        }

        return count($errors) === $before ? $out : null;
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function objectAdd(array $op, string $field, array &$errors): ?array
    {
        if (!array_key_exists('object', $op)) {
            $errors[$field . '.object'] = 'required';

            return null;
        }
        $max = (float) MapInput::GRID_MAX;
        $object = ObjectRules::object($op['object'], $field . '.object', $errors, $max, $max, Fields::id(...), true);

        return $object === null ? null : ['type' => 'object.add', 'object' => $object];
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function tokenAdd(array $op, string $field, array &$errors): ?array
    {
        $f = $field . '.token';
        if (!array_key_exists('token', $op)) {
            $errors[$f] = 'required';

            return null;
        }
        $t = Fields::object($op['token'], TokenRules::TOKEN_KEYS);
        if ($t === null || $t === []) {
            $errors[$f] = 'invalid';

            return null;
        }
        $before = count($errors);
        $uid = ObjectRules::uid($t, 'uid', $f . '.uid', $errors);
        $floor = Fields::id($t['floor'] ?? null);
        if ($floor === null) {
            $errors[$f . '.floor'] = array_key_exists('floor', $t) ? 'invalid' : 'required';
        }
        $tokenId = Fields::id($t['token_id'] ?? null);
        if ($tokenId === null) {
            $errors[$f . '.token_id'] = array_key_exists('token_id', $t) ? 'invalid' : 'required';
        }
        if (array_key_exists('rev', $t) && Fields::int($t['rev'], 0, PHP_INT_MAX) === null) {
            $errors[$f . '.rev'] = 'invalid';
        }
        $max = (float) MapInput::GRID_MAX;
        $placement = TokenRules::placement($t, $f, $errors, $max, $max);
        if (count($errors) !== $before || $placement === null) {
            return null;
        }

        return ['type' => 'maptoken.add', 'token' => ['uid' => $uid, 'floor' => $floor, 'token_id' => $tokenId] + $placement];
    }

    /**
     * object.update / maptoken.update.
     *
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function update(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        $uid = ObjectRules::uid($op, 'uid', $field . '.uid', $errors);
        $rev = Fields::int($op['rev'] ?? null, 0, PHP_INT_MAX);
        if ($rev === null) {
            $errors[$field . '.rev'] = array_key_exists('rev', $op) ? 'invalid' : 'required';
        }
        $max = (float) MapInput::GRID_MAX;
        $patch = $op['type'] === 'object.update'
            ? ObjectRules::patch($op['patch'] ?? null, $field . '.patch', $errors)
            : TokenRules::patch($op['patch'] ?? null, $field . '.patch', $errors, $max, $max);

        return count($errors) === $before && $patch !== null
            ? ['type' => $op['type'], 'uid' => $uid, 'rev' => $rev, 'patch' => $patch]
            : null;
    }

    /**
     * object.remove / maptoken.remove.
     *
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function remove(array $op, string $field, array &$errors): ?array
    {
        $uid = ObjectRules::uid($op, 'uid', $field . '.uid', $errors);

        return $uid === null ? null : ['type' => $op['type'], 'uid' => $uid];
    }

    /**
     * fog.reveal / fog.hide: chunks decoded to raw 2 048-byte bitmaps.
     *
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function fog(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        $floor = Fields::id($op['floor'] ?? null);
        if ($floor === null) {
            $errors[$field . '.floor'] = array_key_exists('floor', $op) ? 'invalid' : 'required';
        }
        $chunks = $op['chunks'] ?? null;
        $out = [];
        if (!is_array($chunks) || !array_is_list($chunks)) {
            $errors[$field . '.chunks'] = $chunks === null ? 'required' : 'invalid';
        } elseif (count($chunks) > self::MAX_FOG_CHUNKS) {
            $errors[$field . '.chunks'] = 'too_many';
        } else {
            $maxChunk = (MapInput::GRID_MAX - 1) >> 5;
            foreach ($chunks as $j => $chunk) {
                $raw = null;
                if (is_array($chunk) && array_is_list($chunk) && count($chunk) === 3) {
                    [$cx, $cy, $data] = $chunk;
                    $cx = Fields::int($cx, 0, $maxChunk);
                    $cy = Fields::int($cy, 0, $maxChunk);
                    $raw = $cx === null || $cy === null ? null : FogCodec::fromBase64($data);
                }
                if ($raw === null) {
                    $errors[$field . '.chunks.' . $j] = 'invalid';
                    break;
                }
                $out[] = [$cx, $cy, $raw];
            }
        }

        return count($errors) === $before ? ['type' => $op['type'], 'floor' => $floor, 'chunks' => $out] : null;
    }
}
