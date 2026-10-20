<?php

declare(strict_types=1);

namespace JDR\Domain\Support;

defined('JDR_BOOT') || exit;

/**
 * DATETIME (UTC) <-> ISO 8601 for JSON ("2026-10-20T19:35:00Z").
 */
final class Dates
{
    public static function iso(mixed $sql): ?string
    {
        if (!is_string($sql) || $sql === '') {
            return null;
        }
        $dt = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $sql, new \DateTimeZone('UTC'));

        return $dt === false ? null : $dt->format('Y-m-d\TH:i:s\Z');
    }

    public static function isoFromTimestamp(int $timestamp): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', $timestamp);
    }

    public static function sql(int $timestamp): string
    {
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    public static function timestamp(mixed $sql): ?int
    {
        if (!is_string($sql) || $sql === '') {
            return null;
        }
        $dt = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $sql, new \DateTimeZone('UTC'));

        return $dt === false ? null : $dt->getTimestamp();
    }
}
