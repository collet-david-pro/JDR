<?php

declare(strict_types=1);

namespace JDR\Domain\Procgen;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\Asset;
use JDR\Domain\Support\AppPaths;

/**
 * Reads and validates app/Seed/base-pack/pack.json (placeholder pack of the procedural generators,
 * produced by the front-end generators; see frontend/tests/procgen/textures/base-pack.test.ts).
 */
final class BasePackManifest
{
    public const RELATIVE_FILE = '/app/Seed/base-pack/pack.json';

    private string $file;

    /** @var array{version: int, entries: list<array<string, mixed>>}|null */
    private ?array $data = null;

    /**
     * @param ?string $file explicit manifest path (tests); default: the one shipped with the code
     */
    public function __construct(?AppPaths $paths = null, ?string $file = null)
    {
        $resolved = $file ?? ($paths !== null ? $paths->codeRoot . self::RELATIVE_FILE : null);
        if ($resolved === null) {
            throw new \InvalidArgumentException('No base pack manifest path.');
        }
        $this->file = $resolved;
    }

    public function directory(): string
    {
        return dirname($this->file);
    }

    public function version(): int
    {
        return $this->load()['version'];
    }

    /**
     * @return list<array{key: string, file: string, name: string, category: string, kind: string, tags: list<string>, rgba_sha256: string}>
     */
    public function entries(): array
    {
        /** @var list<array{key: string, file: string, name: string, category: string, kind: string, tags: list<string>, rgba_sha256: string}> */
        return $this->load()['entries'];
    }

    /**
     * @return array{version: int, entries: list<array<string, mixed>>}
     */
    private function load(): array
    {
        if ($this->data !== null) {
            return $this->data;
        }
        $json = is_file($this->file) ? file_get_contents($this->file) : false;
        if ($json === false) {
            throw new \RuntimeException('Base pack manifest not readable: ' . $this->file);
        }
        try {
            $raw = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \RuntimeException('Base pack manifest is not valid JSON.', 0, $e);
        }
        if (!is_array($raw) || !is_int($raw['version'] ?? null) || $raw['version'] < 1 || !is_array($raw['entries'] ?? null)) {
            throw new \RuntimeException('Base pack manifest: bad header.');
        }
        $seen = [];
        $entries = [];
        foreach ($raw['entries'] as $i => $e) {
            $entries[] = $this->entry($e, (int) $i, $seen);
        }

        return $this->data = ['version' => $raw['version'], 'entries' => $entries];
    }

    /**
     * @param array<string, true> $seen
     * @return array<string, mixed>
     */
    private function entry(mixed $e, int $i, array &$seen): array
    {
        $fail = static fn (string $why): \RuntimeException => new \RuntimeException(sprintf('Base pack manifest: entry %d: %s.', $i, $why));
        if (!is_array($e)) {
            throw $fail('not an object');
        }
        $key = $e['key'] ?? null;
        if (!is_string($key) || preg_match('/^(floor|terrain|decor)\.[a-z0-9_]{1,40}$/', $key) !== 1 || isset($seen[$key])) {
            throw $fail('bad or duplicate key');
        }
        $seen[$key] = true;
        $file = $e['file'] ?? null;
        if (!is_string($file) || preg_match('/^[A-Za-z0-9_.-]{1,80}\.png$/', $file) !== 1 || str_contains($file, '..')) {
            throw $fail('bad file name');
        }
        $name = $e['name'] ?? null;
        if (!is_string($name) || $name === '' || mb_strlen($name, 'UTF-8') > 120) {
            throw $fail('bad name');
        }
        $category = $e['category'] ?? null;
        if (!is_string($category) || mb_strlen($category, 'UTF-8') > 80) {
            throw $fail('bad category');
        }
        $kind = $e['kind'] ?? null;
        if (!is_string($kind) || !in_array($kind, Asset::KINDS, true)) {
            throw $fail('bad kind');
        }
        $tags = $e['tags'] ?? [];
        if (!is_array($tags) || !array_is_list($tags) || count($tags) > 5) {
            throw $fail('bad tags');
        }
        foreach ($tags as $t) {
            if (!is_string($t) || $t === '') {
                throw $fail('bad tag');
            }
        }
        $sha = $e['rgba_sha256'] ?? null;
        if (!is_string($sha) || preg_match('/^[0-9a-f]{64}$/', $sha) !== 1) {
            throw $fail('bad rgba_sha256');
        }
        if (!is_file($this->directory() . '/' . $file)) {
            throw $fail('missing file ' . $file);
        }

        return ['key' => $key, 'file' => $file, 'name' => $name, 'category' => $category, 'kind' => $kind, 'tags' => array_values($tags), 'rgba_sha256' => $sha];
    }
}
