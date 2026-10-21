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
    public static function u8(string $data, int $offset): int
    {
        self::need($data, $offset, 1);

        return ord($data[$offset]);
    }

    public static function u16le(string $data, int $offset): int
    {
        self::need($data, $offset, 2);

        return ord($data[$offset]) | (ord($data[$offset + 1]) << 8);
    }

    public static function u16be(string $data, int $offset): int
    {
        self::need($data, $offset, 2);

        return (ord($data[$offset]) << 8) | ord($data[$offset + 1]);
    }

    public static function u24le(string $data, int $offset): int
    {
        self::need($data, $offset, 3);

        return ord($data[$offset]) | (ord($data[$offset + 1]) << 8) | (ord($data[$offset + 2]) << 16);
    }

    public static function u32le(string $data, int $offset): int
    {
        self::need($data, $offset, 4);

        return ord($data[$offset]) | (ord($data[$offset + 1]) << 8)
            | (ord($data[$offset + 2]) << 16) | (ord($data[$offset + 3]) << 24);
    }

    public static function u32be(string $data, int $offset): int
    {
        self::need($data, $offset, 4);

        return (ord($data[$offset]) << 24) | (ord($data[$offset + 1]) << 16)
            | (ord($data[$offset + 2]) << 8) | ord($data[$offset + 3]);
    }

    public static function slice(string $data, int $offset, int $length): string
    {
        self::need($data, $offset, $length);

        return substr($data, $offset, $length);
    }

    public static function pack24le(int $value): string
    {
        return chr($value & 0xFF) . chr(($value >> 8) & 0xFF) . chr(($value >> 16) & 0xFF);
    }

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
