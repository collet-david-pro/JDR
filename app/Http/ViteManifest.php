<?php

declare(strict_types=1);

namespace JDR\Http;

defined('JDR_BOOT') || exit;

/**
 * Reader for the standard Vite manifest (assets/vite-manifest.json).
 * File paths are relative to the assets/ folder.
 */
final class ViteManifest
{
    /**
     * @param array<string, mixed> $chunks
     */
    private function __construct(private array $chunks)
    {
    }

    public static function load(string $file): ?self
    {
        if (!is_file($file)) {
            return null;
        }
        $json = file_get_contents($file);
        $data = is_string($json) ? json_decode($json, true) : null;

        return is_array($data) ? new self($data) : null;
    }

    /**
     * @param array<string, mixed> $chunks
     */
    public static function fromArray(array $chunks): self
    {
        return new self($chunks);
    }

    /**
     * Entry script, its CSS (including CSS of statically imported chunks) and JS chunks to preload.
     *
     * @return array{file: string, css: list<string>, preload: list<string>}|null
     */
    public function entry(string $name = 'src/main.ts'): ?array
    {
        $chunk = $this->chunks[$name] ?? null;
        if (!is_array($chunk) || !self::isSafe($chunk['file'] ?? null)) {
            return null;
        }
        $css = [];
        $preload = [];
        $seen = [];
        $this->collect($name, $css, $preload, $seen, true);

        return [
            'file' => (string) $chunk['file'],
            'css' => array_values(array_unique($css)),
            'preload' => array_values(array_unique($preload)),
        ];
    }

    /**
     * @param list<string>        $css
     * @param list<string>        $preload
     * @param array<string, bool> $seen
     */
    private function collect(string $name, array &$css, array &$preload, array &$seen, bool $isEntry): void
    {
        if (isset($seen[$name]) || !is_array($this->chunks[$name] ?? null)) {
            return;
        }
        $seen[$name] = true;
        $chunk = $this->chunks[$name];
        if (!$isEntry && self::isSafe($chunk['file'] ?? null)) {
            $preload[] = (string) $chunk['file'];
        }
        foreach ((array) ($chunk['css'] ?? []) as $file) {
            if (self::isSafe($file)) {
                $css[] = (string) $file;
            }
        }
        foreach ((array) ($chunk['imports'] ?? []) as $import) {
            if (is_string($import)) {
                $this->collect($import, $css, $preload, $seen, false);
            }
        }
    }

    private static function isSafe(mixed $file): bool
    {
        return is_string($file)
            && preg_match('#^[A-Za-z0-9_][A-Za-z0-9._/-]*$#', $file) === 1
            && !str_contains($file, '..')
            && !str_contains($file, '//');
    }
}
