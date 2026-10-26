<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Fog chunk codec (projet.md 12.3, same format as frontend/src/formats/fog-codec.ts): 32 x 32
 * cells x 4 x 4 sub-cells = 128 x 128 bits = 2 048 raw bytes, row-major, most significant bit
 * first, bit set = explored. Stored and sent as raw deflate (gzdeflate / bounded gzinflate);
 * an all-zero bitmap is never stored.
 */
final class FogCodec
{
    public const RAW_BYTES = 2048;
    /** Largest accepted base64 text of one compressed chunk (deflate of 2 048 bytes ~ 2 060). */
    public const MAX_BASE64 = 4096;
    public const LEVEL = 6;

    /**
     * Raw bitmap of compressed data; null unless it inflates to exactly 2 048 bytes.
     */
    public static function decode(string $data): ?string
    {
        if ($data === '') {
            return null;
        }
        $raw = @gzinflate($data, self::RAW_BYTES);

        return is_string($raw) && strlen($raw) === self::RAW_BYTES ? $raw : null;
    }

    /**
     * Raw bitmap of a base64 wire / document value; null when invalid.
     */
    public static function fromBase64(mixed $text): ?string
    {
        if (!is_string($text) || $text === '' || strlen($text) > self::MAX_BASE64) {
            return null;
        }
        $bytes = base64_decode($text, true);

        return $bytes === false ? null : self::decode($bytes);
    }

    public static function encode(string $raw): string
    {
        $data = gzdeflate($raw, self::LEVEL);
        if ($data === false) {
            throw new \RuntimeException('gzdeflate failed.');
        }

        return $data;
    }

    public static function isEmpty(string $raw): bool
    {
        return strspn($raw, "\0") === strlen($raw);
    }

    public static function blank(): string
    {
        return str_repeat("\0", self::RAW_BYTES);
    }

    /** target | src (fog.reveal). */
    public static function union(string $target, string $src): string
    {
        return $target | $src;
    }

    /** target & ~src (fog.hide). */
    public static function subtract(string $target, string $src): string
    {
        return $target & ~$src;
    }
}
