<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Games\GameSettings;
use JDR\Maps\Document\GenerationInput;

/**
 * Validation of the map bodies (contract P4b) and of the map.meta op, plus the decoding of the
 * stored JSON columns (ambient, palette, layers).
 *
 * Bounds: name 1-120, folder <= 191 ("Acte 1/Crypte": segments trimmed, empty ones dropped),
 * grid 1-400 x 1-400 cells, cell_px 16-512, unit_label 1-10, unit_per_cell 0.01-9999.99,
 * sort_order +-1 000 000. Layers (12.1): {id, kind, visible, locked, opacity 0-1, gm_only?},
 * ids among the 8 known layers, unique, kind fixed by the id, the 3 tile layers required.
 * Ambient: {darkness 0-1, tint "#rrggbb", time_of_day null|0-24, weather {type, intensity 0-1}}.
 * Field error codes: required | invalid | too_long | too_small | too_large.
 */
final class MapInput
{
    public const NAME_MAX = 120;
    public const FOLDER_MAX = 191;
    public const GRID_MIN = 1;
    public const GRID_MAX = 400;
    public const SORT_MAX = 1000000;
    public const AUTOTILE_MAX = 40;

    public const TILE_LAYERS = ['ground', 'terrain', 'decor'];
    public const OBJECT_LAYERS = ['walls', 'props', 'lighting', 'labels', 'gm'];
    public const WEATHER_TYPES = ['none', 'rain', 'snow', 'fog', 'storm'];

    public const DEFAULT_AMBIENT = [
        'darkness' => 0,
        'tint' => '#000000',
        'time_of_day' => null,
        'weather' => ['type' => 'none', 'intensity' => 0],
    ];

    private const LAYER_KEYS = ['id', 'kind', 'visible', 'locked', 'opacity', 'gm_only'];
    private const GRID_KEYS = ['width', 'height', 'cell_px', 'unit_label', 'unit_per_cell'];

    /**
     * Default layer stack (12.1), bottom -> top.
     *
     * @return list<array<string, mixed>>
     */
    public static function defaultLayers(): array
    {
        $layers = [];
        foreach ([...self::TILE_LAYERS, ...self::OBJECT_LAYERS] as $id) {
            $layer = [
                'id' => $id,
                'kind' => in_array($id, self::TILE_LAYERS, true) ? 'tiles' : 'objects',
                'visible' => true,
                'locked' => false,
                'opacity' => 1,
            ];
            if ($id === 'gm') {
                $layer['gm_only'] = true;
            }
            $layers[] = $layer;
        }

        return $layers;
    }

    /**
     * POST /games/{id}/maps. Defaults of cell_px, unit_label, unit_per_cell come from the game.
     *
     * @param array<array-key, mixed> $body
     * @param array<string, mixed>    $gameSettings
     * @return array{name: string, folder: ?string, kind: string, width: int, height: int, cell_px: int,
     *     unit_label: string, unit_per_cell: int|float, theme: string}
     * @throws ValidationException
     */
    public static function create(array $body, array $gameSettings): array
    {
        $errors = [];
        $name = self::name($body['name'] ?? null, 'name', $errors);
        $folder = array_key_exists('folder', $body) ? self::folder($body['folder'], 'folder', $errors) : null;
        $kind = $body['kind'] ?? 'battle';
        if (!is_string($kind) || !in_array($kind, Map::KINDS, true)) {
            $errors['kind'] = 'invalid';
        }
        $grid = self::grid(
            array_intersect_key($body, array_flip(self::GRID_KEYS)) + [
                'cell_px' => $gameSettings['default_cell_px'] ?? GameSettings::DEFAULTS['default_cell_px'],
                'unit_label' => $gameSettings['unit_label'] ?? GameSettings::DEFAULTS['unit_label'],
                'unit_per_cell' => $gameSettings['unit_per_cell'] ?? GameSettings::DEFAULTS['unit_per_cell'],
            ],
            '',
            $errors,
        );
        foreach (['width', 'height'] as $required) {
            if (!array_key_exists($required, $body) || $body[$required] === null) {
                $errors[$required] = 'required';
            }
        }
        $theme = array_key_exists('theme', $body) ? self::theme($body['theme'], 'theme', $errors) : 'parchment';
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return [
            'name' => (string) $name,
            'folder' => $folder,
            'kind' => (string) $kind,
            'width' => (int) $grid['width'],
            'height' => (int) $grid['height'],
            'cell_px' => (int) $grid['cell_px'],
            'unit_label' => (string) $grid['unit_label'],
            'unit_per_cell' => $grid['unit_per_cell'],
            'theme' => (string) $theme,
        ];
    }

    /**
     * PATCH /maps/{id} {name?, folder?|null, sort_order?, generation?|null}.
     *
     * @param array<array-key, mixed> $body
     * @return array{name?: string, folder?: ?string, sort_order?: int, generation?: ?array<string, mixed>}
     * @throws ValidationException
     */
    public static function patch(array $body): array
    {
        $errors = [];
        $changes = [];
        if (array_key_exists('name', $body)) {
            $changes['name'] = (string) self::name($body['name'], 'name', $errors);
        }
        if (array_key_exists('folder', $body)) {
            $changes['folder'] = self::folder($body['folder'], 'folder', $errors);
        }
        if (array_key_exists('sort_order', $body)) {
            [$sort, $error] = self::bounded($body['sort_order'], -self::SORT_MAX, self::SORT_MAX, true);
            if ($error !== null) {
                $errors['sort_order'] = $error;
            } else {
                $changes['sort_order'] = (int) $sort;
            }
        }
        if (array_key_exists('generation', $body)) {
            $changes['generation'] = GenerationInput::parse($body['generation'], $errors);
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $changes;
    }

    /**
     * Map name (1-120, single line); null when invalid (error recorded under $field).
     *
     * @param array<string, string> $errors
     */
    public static function name(mixed $value, string $field, array &$errors): ?string
    {
        if ($value === null || $value === '' || (is_string($value) && trim($value) === '')) {
            $errors[$field] = 'required';

            return null;
        }
        $name = Fields::text($value, PHP_INT_MAX);
        if ($name === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        if (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
            $errors[$field] = 'too_long';

            return null;
        }

        return $name;
    }

    /**
     * Folder path ("Acte 1/Crypte"); null or blank => null.
     *
     * @param array<string, string> $errors
     */
    public static function folder(mixed $value, string $field, array &$errors): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = Fields::text($value, PHP_INT_MAX);
        if ($text === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $segments = array_values(array_filter(
            array_map(static fn (string $s): string => trim($s), explode('/', $text)),
            static fn (string $s): bool => $s !== '',
        ));
        $folder = implode('/', $segments);
        if (mb_strlen($folder, 'UTF-8') > self::FOLDER_MAX) {
            $errors[$field] = 'too_long';

            return null;
        }

        return $folder === '' ? null : $folder;
    }

    /**
     * Grid fields present in $grid (width, height, cell_px, unit_label, unit_per_cell), checked.
     * Errors are recorded as "<prefix><key>".
     *
     * @param array<array-key, mixed> $grid
     * @param array<string, string>   $errors
     * @return array<string, mixed> valid fields only
     */
    public static function grid(array $grid, string $prefix, array &$errors): array
    {
        $out = [];
        foreach ($grid as $key => $value) {
            $field = $prefix . $key;
            [$checked, $error] = match ($key) {
                'width', 'height' => self::bounded($value, self::GRID_MIN, self::GRID_MAX, true),
                'cell_px' => self::bounded($value, GameSettings::CELL_PX_MIN, GameSettings::CELL_PX_MAX, true),
                'unit_per_cell' => self::bounded($value, GameSettings::UNIT_PER_CELL_MIN, GameSettings::UNIT_PER_CELL_MAX, false, 2),
                'unit_label' => self::unitLabel($value),
                default => [null, 'invalid'],
            };
            if ($error !== null) {
                $errors[$field] = $error;
            } else {
                $out[(string) $key] = $checked;
            }
        }

        return $out;
    }

    /**
     * @param array<string, string> $errors
     */
    public static function theme(mixed $value, string $field, array &$errors): ?string
    {
        if (!is_string($value) || !in_array($value, Map::THEMES, true)) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $value;
    }

    /**
     * Complete layer stack (12.1), normalized; null when invalid (error under $field).
     *
     * @param array<string, string> $errors
     * @return list<array<string, mixed>>|null
     */
    public static function layers(mixed $value, string $field, array &$errors): ?array
    {
        if (!is_array($value) || !array_is_list($value) || $value === []) {
            $errors[$field] = 'invalid';

            return null;
        }
        $seen = [];
        $out = [];
        foreach ($value as $i => $layer) {
            $def = Fields::object($layer, self::LAYER_KEYS);
            $id = $def['id'] ?? null;
            $tile = in_array($id, self::TILE_LAYERS, true);
            if ($def === null || !is_string($id) || (!$tile && !in_array($id, self::OBJECT_LAYERS, true))
                || isset($seen[$id]) || ($def['kind'] ?? null) !== ($tile ? 'tiles' : 'objects')) {
                $errors[$field . '.' . $i] = 'invalid';

                return null;
            }
            $seen[$id] = true;
            $norm = ['id' => $id, 'kind' => $tile ? 'tiles' : 'objects', 'visible' => true, 'locked' => false, 'opacity' => 1];
            foreach (['visible', 'locked', 'gm_only'] as $flag) {
                if (array_key_exists($flag, $def)) {
                    if (!is_bool($def[$flag])) {
                        $errors[$field . '.' . $i . '.' . $flag] = 'invalid';

                        return null;
                    }
                    $norm[$flag] = $def[$flag];
                }
            }
            if (($norm['gm_only'] ?? null) === false) {
                unset($norm['gm_only']);
            }
            if (array_key_exists('opacity', $def)) {
                [$opacity, $error] = self::bounded($def['opacity'], 0, 1, false, 3);
                if ($error !== null) {
                    $errors[$field . '.' . $i . '.opacity'] = $error;

                    return null;
                }
                $norm['opacity'] = $opacity;
            }
            $out[] = $norm;
        }
        foreach (self::TILE_LAYERS as $required) {
            if (!isset($seen[$required])) {
                $errors[$field] = 'invalid';

                return null;
            }
        }

        return $out;
    }

    /**
     * Partial ambient merged over $base; null when invalid (errors under "<field>.<key>").
     *
     * @param array<string, mixed>  $base
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function ambient(mixed $value, array $base, string $field, array &$errors): ?array
    {
        $patch = Fields::object($value, array_keys(self::DEFAULT_AMBIENT));
        if ($patch === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach ($patch as $key => $v) {
            if ($key === 'weather') {
                $w = Fields::object($v, ['type', 'intensity']);
                if ($w === null) {
                    $errors[$field . '.weather'] = 'invalid';
                    continue;
                }
                $weather = is_array($base['weather'] ?? null) ? $base['weather'] : self::DEFAULT_AMBIENT['weather'];
                if (array_key_exists('type', $w)) {
                    if (is_string($w['type']) && in_array($w['type'], self::WEATHER_TYPES, true)) {
                        $weather['type'] = $w['type'];
                    } else {
                        $errors[$field . '.weather.type'] = 'invalid';
                    }
                }
                if (array_key_exists('intensity', $w)) {
                    [$n, $error] = self::bounded($w['intensity'], 0, 1, false, 3);
                    if ($error !== null) {
                        $errors[$field . '.weather.intensity'] = $error;
                    } else {
                        $weather['intensity'] = $n;
                    }
                }
                $base['weather'] = $weather;
                continue;
            }
            [$checked, $error] = match ($key) {
                'darkness' => self::bounded($v, 0, 1, false, 3),
                'tint' => Fields::color($v) === null ? [null, 'invalid'] : [Fields::color($v), null],
                'time_of_day' => $v === null ? [null, null] : self::bounded($v, 0, 24, false, 2),
                default => [null, 'invalid'],
            };
            if ($error !== null) {
                $errors[$field . '.' . $key] = $error;
            } else {
                $base[$key] = $checked;
            }
        }

        return count($errors) === $before ? $base : null;
    }

    /**
     * Palette autotile value: null or a short identifier.
     */
    public static function autotile(mixed $value): string|false|null
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value) || preg_match('/^[A-Za-z0-9_.:-]{1,' . self::AUTOTILE_MAX . '}$/D', $value) !== 1) {
            return false;
        }

        return $value;
    }

    /**
     * Checked number: [value, null] or [null, error code].
     *
     * @return array{0: int|float|null, 1: ?string}
     */
    private static function bounded(mixed $value, float $min, float $max, bool $integer, int $decimals = 3): array
    {
        $checked = $integer ? Fields::int($value, (int) $min, (int) $max) : Fields::number($value, $min, $max, $decimals);
        if ($checked === null) {
            return [null, Fields::numberError($value, $min, $max, $integer) ?? 'invalid'];
        }

        return [$checked, null];
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    private static function unitLabel(mixed $value): array
    {
        $label = Fields::text($value, PHP_INT_MAX);
        if ($label === null) {
            return [null, 'invalid'];
        }
        if ($label === '') {
            return [null, 'required'];
        }

        return mb_strlen($label, 'UTF-8') > GameSettings::UNIT_LABEL_MAX ? [null, 'too_long'] : [$label, null];
    }

    // ---- Stored JSON (opaque for SQL) ------------------------------------------------------

    /**
     * @return array<string, mixed>
     */
    public static function storedAmbient(mixed $json): array
    {
        $data = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($data)) {
            return self::DEFAULT_AMBIENT;
        }
        $errors = [];

        return self::ambient(array_intersect_key($data, self::DEFAULT_AMBIENT), self::DEFAULT_AMBIENT, 'ambient', $errors)
            ?? self::DEFAULT_AMBIENT;
    }

    /**
     * @return list<array{asset_id: int, autotile?: ?string}|null>
     */
    public static function storedPalette(mixed $json): array
    {
        $data = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($data) || !array_is_list($data) || $data === []) {
            return [null];
        }
        $out = [];
        foreach ($data as $i => $entry) {
            $assetId = is_array($entry) ? Fields::id($entry['asset_id'] ?? null) : null;
            if ($i === 0 || $assetId === null) {
                $out[] = null;
                continue;
            }
            $item = ['asset_id' => $assetId];
            $autotile = self::autotile($entry['autotile'] ?? null);
            if (is_string($autotile)) {
                $item['autotile'] = $autotile;
            }
            $out[] = $item;
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function storedLayers(mixed $json): array
    {
        $data = is_string($json) ? json_decode($json, true) : null;
        $errors = [];

        return self::layers($data, 'layers', $errors) ?? self::defaultLayers();
    }
}
