<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Identifiers are integers in the database but strings in JSON (BIGINT precision in JavaScript).
 */
final class Ids
{
    /**
     * Recursively converts integer values of keys "id", "*_id" and lists under "*_ids" to strings.
     */
    public static function stringify(mixed $data): mixed
    {
        if (!is_array($data)) {
            return $data;
        }
        $out = [];
        foreach ($data as $key => $value) {
            if (is_string($key) && is_int($value) && self::isIdKey($key)) {
                $out[$key] = (string) $value;
            } elseif (is_string($key) && is_array($value) && str_ends_with($key, '_ids')) {
                $out[$key] = array_map(
                    static fn (mixed $v): mixed => is_int($v) ? (string) $v : self::stringify($v),
                    $value,
                );
            } else {
                $out[$key] = self::stringify($value);
            }
        }

        return $out;
    }

    private static function isIdKey(string $key): bool
    {
        return $key === 'id' || str_ends_with($key, '_id');
    }
}
