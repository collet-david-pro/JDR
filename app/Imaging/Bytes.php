<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Bounds-checked integer reads/writes in binary strings. Every read past the end throws
 * \OutOfRangeException, which the parsers turn into an "invalid structure" refusal.
 */
final class Bytes
{
    /**
     * Reads an unsigned byte.
     */
    public static function u8(string $data, int $offset): int
    {
        self::need($data, $offset, 1);

        return ord($data[$offset]);
    }

    /**
     * Reads an unsigned 16-bit little-endian integer.
     */
    public static function u16le(string $data, int $offset): int
    {
        self::need($data, $offset, 2);

        return ord($data[$offset]) | (ord($data[$offset + 1]) << 8);
    }

    /**
     * Reads an unsigned 16-bit big-endian integer.
     */
    public static function u16be(string $data, int $offset): int
    {
        self::need($data, $offset, 2);

        return (ord($data[$offset]) << 8) | ord($data[$offset + 1]);
    }

    /**
     * Reads an unsigned 24-bit little-endian integer.
     */
    public static function u24le(string $data, int $offset): int
    {
        self::need($data, $offset, 3);

        return ord($data[$offset]) | (ord($data[$offset + 1]) << 8) | (ord($data[$offset + 2]) << 16);
    }

    /**
     * Reads an unsigned 32-bit little-endian integer.
     */
    public static function u32le(string $data, int $offset): int
    {
        self::need($data, $offset, 4);

        return ord($data[$offset]) | (ord($data[$offset + 1]) << 8)
            | (ord($data[$offset + 2]) << 16) | (ord($data[$offset + 3]) << 24);
    }

    /**
     * Reads an unsigned 32-bit big-endian integer.
     */
    public static function u32be(string $data, int $offset): int
    {
        self::need($data, $offset, 4);

        return (ord($data[$offset]) << 24) | (ord($data[$offset + 1]) << 16)
            | (ord($data[$offset + 2]) << 8) | ord($data[$offset + 3]);
    }

    /**
     * Returns a substring, throwing when the range exceeds the data.
     *
     * @throws \OutOfRangeException When the range is out of bounds.
     */
    public static function slice(string $data, int $offset, int $length): string
    {
        self::need($data, $offset, $length);

        return substr($data, $offset, $length);
    }

    /**
     * Packs an integer as 3 little-endian bytes.
     */
    public static function pack24le(int $value): string
    {
        return chr($value & 0xFF) . chr(($value >> 8) & 0xFF) . chr(($value >> 16) & 0xFF);
    }

    /**
     * Packs an integer as 4 little-endian bytes.
     */
    public static function pack32le(int $value): string
    {
        return pack('V', $value);
    }

    private static function need(string $data, int $offset, int $length): void
    {
        if ($offset < 0 || $length < 0 || $offset + $length > strlen($data)) {
            throw new \OutOfRangeException('Unexpected end of data.');
        }
    }
}
