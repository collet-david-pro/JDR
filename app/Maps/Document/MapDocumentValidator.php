<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapOpsInput;
use JDR\Maps\ChunkCodec;
use JDR\Maps\ChunkCodecException;

/**
 * Strict validation of a map document (projet.md 12.1, format_version 1), hand-written
 * equivalent of frontend/src/formats/map.schema.json. Same rules as the ops (11.4, MapInput,
 * MapOpsInput): grid 1-400 x 1-400, cell_px, units, theme, ambient, layers, palette <= 4096 slots
 * (slot 0 empty, "sha256:<hex>" references), floors <= 8, chunks decoded with ChunkCodec (bounded
 * inflate, exact size, magic, version, layer, palette index < palette size), no painted cell
 * outside the grid, flags 0-15. Unknown keys are refused everywhere; "__proto__", "constructor"
 * and "prototype" are refused anywhere (free-form generation.params included).
 *
 * P4 has no objects, notes, links, placed tokens nor fog: those keys are accepted only empty
 * ("unsupported" otherwise, nothing would be silently dropped).
 *
 * Older documents are migrated first (MapDocumentMigrator); newer ones are refused
 * (422 unsupported_format_version). Errors: 422 validation_failed, fields keyed by JSON path
 * ("palette.3.asset", "chunks.f1.ground.0:0"...), codes required | invalid | too_long |
 * too_small | too_large | too_many | not_found | duplicate | unsupported | out_of_bounds |
 * dangerous_key | bad_flags | bad_size | bad_magic | bad_version | bad_layer |
 * bad_palette_index | bad_compression.
 *
 * Result (normalized document):
 * {format_version, name, kind, grid {type, cell_px, width, height, unit_label, unit_per_cell},
 *  theme, ambient, palette [null | {sha256, name, autotile, asset_id?}], layers,
 *  floors [{uid, level, name}], chunks [{floor (uid), layer, cx, cy, raw (4 104 bytes)}],
 *  generation null | {generator, gen_version, seed, params}}.
 * Raw chunks are canonical (empty cells all zero); empty chunks are dropped.
 */
final class MapDocumentValidator
{
    public const FORMAT = 'jdr-map';
    public const MAX_BYTES = 16777216;
    public const MAX_DEPTH = 64;
    public const MAX_FLOORS = 8;
    public const LEVEL_MIN = -100;
    public const LEVEL_MAX = 100;
    public const FLOOR_NAME_MAX = 60;
    public const MAX_CHUNK_BASE64 = 8192;
    public const MAX_PARAMS_BYTES = 65536;
    public const MAX_ERRORS = 50;
    public const FLOOR_UID_PATTERN = '/^[A-Za-z0-9_-]{1,21}$/D';
    public const ASSET_REF_PATTERN = '/^sha256:([0-9a-fA-F]{64})$/D';
    public const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

    private const TOP_KEYS = [
        'format', 'format_version', 'app_version', 'name', 'kind', 'grid', 'theme', 'ambient', 'palette',
        'layers', 'floors', 'chunks', 'fog', 'objects', 'notes', 'links', 'tokens_placed', 'generation',
    ];
    private const REQUIRED_KEYS = ['format', 'format_version', 'name', 'grid', 'palette', 'layers', 'floors', 'chunks'];
    private const GRID_KEYS = ['type', 'cell_px', 'width', 'height', 'unit_label', 'unit_per_cell'];
    private const PALETTE_KEYS = ['asset', 'name', 'autotile'];
    private const FLOOR_KEYS = ['uid', 'level', 'name'];
    private const GENERATION_KEYS = ['generator', 'gen_version', 'seed', 'params'];

    public function __construct(private MapDocumentMigrator $migrator = new MapDocumentMigrator())
    {
    }

    /**
     * Decodes the JSON text of a document (bounded size and depth).
     *
     * @return array<array-key, mixed>
     * @throws ValidationException 422 invalid_map_file
     */
    public static function decode(string $json): array
    {
        if (strlen($json) > self::MAX_BYTES) {
            throw new ValidationException('', ['file' => 'too_large'], 'invalid_map_file');
        }
        if (str_starts_with($json, "\xEF\xBB\xBF")) {
            $json = substr($json, 3);
        }
        try {
            $doc = json_decode($json, true, self::MAX_DEPTH, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        } catch (\JsonException) {
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_map_file');
        }
        if (!is_array($doc) || ($doc !== [] && array_is_list($doc))) {
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_map_file');
        }

        return $doc;
    }

    /**
     * Migrates then validates a decoded document.
     *
     * @param array<array-key, mixed> $doc
     * @param bool                    $internal server snapshot: palette entries may carry asset_id
     * @return array<string, mixed> normalized document (see the class comment)
     * @throws ValidationException
     */
    public function validate(array $doc, bool $internal = false): array
    {
        $dangerous = self::findDangerousKey($doc, '');
        if ($dangerous !== null) {
            throw new ValidationException('', [$dangerous => 'dangerous_key']);
        }
        if (($doc['format'] ?? null) !== self::FORMAT) {
            throw new ValidationException('', ['format' => array_key_exists('format', $doc) ? 'invalid' : 'required']);
        }
        $doc = $this->migrator->migrate($doc);

        $errors = [];
        foreach (array_keys($doc) as $key) {
            if (!is_string($key) || !in_array($key, self::TOP_KEYS, true)) {
                $errors[(string) $key] = 'unsupported';
            }
        }
        foreach (self::REQUIRED_KEYS as $key) {
            if (!array_key_exists($key, $doc)) {
                $errors[$key] = 'required';
            }
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        if (array_key_exists('app_version', $doc) && Fields::text($doc['app_version'], 40) === null) {
            $errors['app_version'] = 'invalid';
        }
        $name = MapInput::name($doc['name'], 'name', $errors);
        $kind = $doc['kind'] ?? 'battle';
        if (!is_string($kind) || !in_array($kind, Map::KINDS, true)) {
            $errors['kind'] = 'invalid';
        }
        $grid = $this->grid($doc['grid'], $errors);
        $theme = array_key_exists('theme', $doc) ? MapInput::theme($doc['theme'], 'theme', $errors) : 'parchment';
        $ambient = array_key_exists('ambient', $doc)
            ? MapInput::ambient($doc['ambient'], MapInput::DEFAULT_AMBIENT, 'ambient', $errors)
            : MapInput::DEFAULT_AMBIENT;
        $layers = MapInput::layers($doc['layers'], 'layers', $errors);
        $palette = $this->palette($doc['palette'], $internal, $errors);
        $floors = $this->floors($doc['floors'], $errors);
        foreach (['objects', 'notes', 'links', 'tokens_placed'] as $key) {
            if (array_key_exists($key, $doc) && $doc[$key] !== null && $doc[$key] !== []) {
                $errors[$key] = is_array($doc[$key]) && array_is_list($doc[$key]) ? 'unsupported' : 'invalid';
            }
        }
        if (array_key_exists('fog', $doc) && !self::isEmptyFog($doc['fog'])) {
            $errors['fog'] = is_array($doc['fog']) ? 'unsupported' : 'invalid';
        }
        $generation = array_key_exists('generation', $doc) ? $this->generation($doc['generation'], $errors) : null;
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        assert($grid !== null && $palette !== null && $floors !== null && $layers !== null && $ambient !== null);
        $chunks = $this->chunks($doc['chunks'], $floors, $grid, count($palette));

        return [
            'format_version' => $this->migrator->current(),
            'name' => (string) $name,
            'kind' => (string) $kind,
            'grid' => $grid,
            'theme' => (string) $theme,
            'ambient' => $ambient,
            'palette' => $palette,
            'layers' => $layers,
            'floors' => $floors,
            'chunks' => $chunks,
            'generation' => $generation,
        ];
    }

    /**
     * Path of the first forbidden key ("__proto__"...), null when none.
     */
    public static function findDangerousKey(mixed $value, string $path): ?string
    {
        if (!is_array($value)) {
            return null;
        }
        foreach ($value as $key => $child) {
            $here = $path === '' ? (string) $key : $path . '.' . $key;
            if (is_string($key) && in_array(strtolower($key), self::DANGEROUS_KEYS, true)) {
                return $here;
            }
            if (is_array($child)) {
                $found = self::findDangerousKey($child, $here);
                if ($found !== null) {
                    return $found;
                }
            }
        }

        return null;
    }

    /**
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private function grid(mixed $value, array &$errors): ?array
    {
        $grid = Fields::object($value, self::GRID_KEYS);
        if ($grid === null) {
            $errors['grid'] = 'invalid';

            return null;
        }
        $before = count($errors);
        if (($grid['type'] ?? 'square') !== 'square') {
            $errors['grid.type'] = 'unsupported';
        }
        foreach (['cell_px', 'width', 'height', 'unit_label', 'unit_per_cell'] as $key) {
            if (!array_key_exists($key, $grid)) {
                $errors['grid.' . $key] = 'required';
            }
        }
        unset($grid['type']);
        $checked = MapInput::grid($grid, 'grid.', $errors);
        if (count($errors) !== $before) {
            return null;
        }

        return [
            'type' => 'square',
            'cell_px' => (int) $checked['cell_px'],
            'width' => (int) $checked['width'],
            'height' => (int) $checked['height'],
            'unit_label' => (string) $checked['unit_label'],
            'unit_per_cell' => $checked['unit_per_cell'],
        ];
    }

    /**
     * @param array<string, string> $errors
     * @return list<array{sha256: string, name: string, autotile: ?string, asset_id?: int}|null>|null
     */
    private function palette(mixed $value, bool $internal, array &$errors): ?array
    {
        if (!is_array($value) || !array_is_list($value) || $value === []) {
            $errors['palette'] = 'invalid';

            return null;
        }
        if (count($value) > MapOpsInput::MAX_PALETTE) {
            $errors['palette'] = 'too_many';

            return null;
        }
        if ($value[0] !== null) {
            $errors['palette.0'] = 'invalid';

            return null;
        }
        $keys = $internal ? [...self::PALETTE_KEYS, 'asset_id'] : self::PALETTE_KEYS;
        $out = [null];
        $before = count($errors);
        for ($i = 1, $n = count($value); $i < $n; $i++) {
            $entry = $value[$i];
            if ($entry === null) {
                $out[] = null;
                continue;
            }
            $field = 'palette.' . $i;
            $item = Fields::object($entry, $keys);
            if ($item === null) {
                $errors[$field] = 'invalid';
            } elseif (!is_string($item['asset'] ?? null) || preg_match(self::ASSET_REF_PATTERN, $item['asset'], $m) !== 1) {
                $errors[$field . '.asset'] = array_key_exists('asset', $item) ? 'invalid' : 'required';
            } else {
                $name = $item['name'] ?? '';
                $name = $name === null ? '' : Fields::text($name, PHP_INT_MAX);
                $autotile = MapInput::autotile($item['autotile'] ?? null);
                $assetId = array_key_exists('asset_id', $item) ? Fields::id($item['asset_id']) : null;
                if ($name === null || mb_strlen($name, 'UTF-8') > MapInput::NAME_MAX) {
                    $errors[$field . '.name'] = $name === null ? 'invalid' : 'too_long';
                } elseif ($autotile === false) {
                    $errors[$field . '.autotile'] = 'invalid';
                } elseif (array_key_exists('asset_id', $item) && $assetId === null) {
                    $errors[$field . '.asset_id'] = 'invalid';
                } else {
                    $entryOut = ['sha256' => strtolower($m[1]), 'name' => $name, 'autotile' => $autotile];
                    if ($assetId !== null) {
                        $entryOut['asset_id'] = $assetId;
                    }
                    $out[] = $entryOut;
                    continue;
                }
            }
            if (count($errors) - $before >= self::MAX_ERRORS) {
                break;
            }
            $out[] = null;
        }

        return count($errors) === $before ? $out : null;
    }

    /**
     * @param array<string, string> $errors
     * @return list<array{uid: string, level: int, name: string}>|null
     */
    private function floors(mixed $value, array &$errors): ?array
    {
        if (!is_array($value) || !array_is_list($value) || $value === []) {
            $errors['floors'] = 'invalid';

            return null;
        }
        if (count($value) > self::MAX_FLOORS) {
            $errors['floors'] = 'too_many';

            return null;
        }
        $out = [];
        $uids = [];
        $levels = [];
        $before = count($errors);
        foreach ($value as $i => $floor) {
            $field = 'floors.' . $i;
            $f = Fields::object($floor, self::FLOOR_KEYS);
            if ($f === null) {
                $errors[$field] = 'invalid';
                continue;
            }
            $uid = $f['uid'] ?? null;
            if (!is_string($uid) || preg_match(self::FLOOR_UID_PATTERN, $uid) !== 1) {
                $errors[$field . '.uid'] = array_key_exists('uid', $f) ? 'invalid' : 'required';
            } elseif (isset($uids[$uid])) {
                $errors[$field . '.uid'] = 'duplicate';
            }
            $level = Fields::int($f['level'] ?? null, self::LEVEL_MIN, self::LEVEL_MAX);
            if ($level === null) {
                $errors[$field . '.level'] = array_key_exists('level', $f) ? 'invalid' : 'required';
            } elseif (isset($levels[$level])) {
                $errors[$field . '.level'] = 'duplicate';
            }
            $name = Fields::text($f['name'] ?? null, PHP_INT_MAX);
            if ($name === null || trim($name) === '') {
                $errors[$field . '.name'] = array_key_exists('name', $f) ? 'invalid' : 'required';
            } elseif (mb_strlen($name, 'UTF-8') > self::FLOOR_NAME_MAX) {
                $errors[$field . '.name'] = 'too_long';
            }
            if (count($errors) === $before) {
                $uids[(string) $uid] = true;
                $levels[(int) $level] = true;
                $out[] = ['uid' => (string) $uid, 'level' => (int) $level, 'name' => trim((string) $name)];
            }
        }

        return count($errors) === $before ? $out : null;
    }

    /**
     * @param array<string, string> $errors
     * @return array{generator: string, gen_version: int, seed: string, params: array<array-key, mixed>}|null
     */
    private function generation(mixed $value, array &$errors): ?array
    {
        if ($value === null) {
            return null;
        }
        $g = Fields::object($value, self::GENERATION_KEYS);
        if ($g === null) {
            $errors['generation'] = 'invalid';

            return null;
        }
        $before = count($errors);
        $generator = $g['generator'] ?? null;
        if (!is_string($generator) || preg_match('/^[a-z0-9][a-z0-9_.-]{0,39}$/D', $generator) !== 1) {
            $errors['generation.generator'] = array_key_exists('generator', $g) ? 'invalid' : 'required';
        }
        $genVersion = Fields::int($g['gen_version'] ?? null, 1, 1000000);
        if ($genVersion === null) {
            $errors['generation.gen_version'] = array_key_exists('gen_version', $g) ? 'invalid' : 'required';
        }
        $seed = Fields::text($g['seed'] ?? null, 64);
        if ($seed === null || $seed === '') {
            $errors['generation.seed'] = array_key_exists('seed', $g) ? 'invalid' : 'required';
        }
        $params = $g['params'] ?? [];
        if (!is_array($params) || ($params !== [] && array_is_list($params))) {
            $errors['generation.params'] = 'invalid';
        } elseif (strlen((string) json_encode($params)) > self::MAX_PARAMS_BYTES) {
            $errors['generation.params'] = 'too_large';
        }
        if (count($errors) !== $before) {
            return null;
        }

        return ['generator' => (string) $generator, 'gen_version' => (int) $genVersion, 'seed' => (string) $seed, 'params' => $params];
    }

    /**
     * Decodes, checks and normalizes every chunk.
     *
     * @param list<array{uid: string, level: int, name: string}> $floors
     * @param array<string, mixed>                               $grid
     * @return list<array{floor: string, layer: string, cx: int, cy: int, raw: string}>
     * @throws ValidationException
     */
    private function chunks(mixed $value, array $floors, array $grid, int $paletteSize): array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new ValidationException('', ['chunks' => 'invalid']);
        }
        $known = array_flip(array_column($floors, 'uid'));
        $width = (int) $grid['width'];
        $height = (int) $grid['height'];
        $out = [];
        foreach ($value as $uid => $layers) {
            $uid = (string) $uid;
            if (!isset($known[$uid])) {
                throw new ValidationException('', ['chunks.' . $uid => 'not_found']);
            }
            $layers = Fields::object($layers, MapInput::TILE_LAYERS);
            if ($layers === null) {
                throw new ValidationException('', ['chunks.' . $uid => 'invalid']);
            }
            foreach ($layers as $layer => $blocks) {
                $base = 'chunks.' . $uid . '.' . $layer;
                if (!is_array($blocks) || ($blocks !== [] && array_is_list($blocks))) {
                    throw new ValidationException('', [$base => 'invalid']);
                }
                foreach ($blocks as $key => $data) {
                    $field = $base . '.' . $key;
                    $out[] = ['floor' => $uid, 'layer' => $layer] + $this->chunk((string) $key, $data, $layer, $width, $height, $paletteSize, $field);
                }
            }
        }

        return array_values(array_filter($out, static fn (array $c): bool => $c['raw'] !== ''));
    }

    /**
     * @return array{cx: int, cy: int, raw: string} raw = '' for an empty chunk
     * @throws ValidationException
     */
    private function chunk(string $key, mixed $data, string $layer, int $width, int $height, int $paletteSize, string $field): array
    {
        if (preg_match('/^(\d{1,3}):(\d{1,3})$/D', $key, $m) !== 1) {
            throw new ValidationException('', [$field => 'invalid']);
        }
        $cx = (int) $m[1];
        $cy = (int) $m[2];
        if ($cx * ChunkCodec::SIZE >= $width || $cy * ChunkCodec::SIZE >= $height) {
            throw new ValidationException('', [$field => 'out_of_bounds']);
        }
        if (!is_string($data) || $data === '' || strlen($data) > self::MAX_CHUNK_BASE64) {
            throw new ValidationException('', [$field => is_string($data) && $data !== '' ? 'too_large' : 'invalid']);
        }
        $bytes = base64_decode($data, true);
        if ($bytes === false || $bytes === '') {
            throw new ValidationException('', [$field => 'invalid']);
        }
        try {
            $raw = ChunkCodec::decode($bytes, $layer, $paletteSize);
        } catch (ChunkCodecException $e) {
            throw new ValidationException('', [$field => $e->reason]);
        }
        $x0 = $cx * ChunkCodec::SIZE;
        $y0 = $cy * ChunkCodec::SIZE;
        $empty = true;
        for ($y = 0; $y < ChunkCodec::SIZE; $y++) {
            for ($x = 0; $x < ChunkCodec::SIZE; $x++) {
                $offset = ChunkCodec::offset($x, $y);
                $index = ChunkCodec::indexAt($raw, $offset);
                if ($index === 0) {
                    if ($raw[$offset + 2] !== "\0" || $raw[$offset + 3] !== "\0") {
                        ChunkCodec::setCell($raw, $offset, 0, 0, 0);
                    }
                    continue;
                }
                if ($x0 + $x >= $width || $y0 + $y >= $height) {
                    throw new ValidationException('', [$field => 'out_of_bounds']);
                }
                if (ord($raw[$offset + 3]) > 0x0f) {
                    throw new ValidationException('', [$field => 'bad_flags']);
                }
                $empty = false;
            }
        }
        // Reserved header bytes are rewritten as zeros.
        $raw = substr($raw, 0, 4) . "\0\0\0\0" . substr($raw, ChunkCodec::HEADER_BYTES);

        return ['cx' => $cx, 'cy' => $cy, 'raw' => $empty ? '' : $raw];
    }

    private static function isEmptyFog(mixed $fog): bool
    {
        if ($fog === null || $fog === []) {
            return true;
        }
        if (!is_array($fog) || array_is_list($fog)) {
            return false;
        }
        foreach ($fog as $floor) {
            if ($floor !== [] && $floor !== null) {
                return false;
            }
        }

        return true;
    }
}
