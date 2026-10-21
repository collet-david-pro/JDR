<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

/**
 * Validated metadata of an asset to import (upload or pack entry).
 */
final class ImportRequest
{
    /**
     * @param ?int         $ownerId    null = general library
     * @param list<string> $tags       normalized tag names
     */
    public function __construct(
        public readonly ?int $ownerId,
        public readonly string $name,
        public readonly string $kind,
        public readonly ?int $categoryId = null,
        public readonly array $tags = [],
        public readonly string $source = 'upload',
    ) {
    }

    /**
     * Asset name from a client file name: base name without extension, cleaned, at most 120 characters.
     */
    public static function nameFromFile(string $fileName): string
    {
        $base = basename(str_replace('\\', '/', $fileName));
        $dot = strrpos($base, '.');
        if ($dot !== false && $dot > 0) {
            $base = substr($base, 0, $dot);
        }
        if (preg_match('//u', $base) !== 1) {
            $base = (string) mb_convert_encoding($base, 'UTF-8', 'UTF-8');
        }
        $base = trim((string) preg_replace(['/[\x00-\x1F\x7F]/u', '/[_\s]+/u'], ['', ' '], $base));
        $base = mb_substr($base, 0, 120, 'UTF-8');

        return $base === '' ? 'image' : $base;
    }
}
