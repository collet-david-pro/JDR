<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;

/**
 * Small input helpers of the asset controllers (ids arrive as JSON strings or numbers, multipart
 * fields as strings).
 */
final class Input
{
    /**
     * Positive id from a string of digits or an integer; null when absent/empty.
     *
     * @throws ValidationException $field invalid
     */
    public static function id(mixed $value, string $field): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_int($value) && $value > 0) {
            return $value;
        }
        if (is_string($value) && ctype_digit($value) && strlen($value) <= 19 && (int) $value > 0) {
            return (int) $value;
        }
        throw new ValidationException('', [$field => 'invalid']);
    }

    /**
     * @return list<int>
     * @throws ValidationException
     */
    public static function ids(mixed $value, string $field, int $max): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > $max) {
            throw new ValidationException('', [$field => 'invalid']);
        }
        $ids = [];
        foreach ($value as $item) {
            $id = self::id($item, $field) ?? throw new ValidationException('', [$field => 'invalid']);
            $ids[$id] = $id;
        }

        return array_values($ids);
    }

    /**
     * Cursor and limit (default 50, max 200).
     *
     * @return array{0: ?int, 1: int}
     */
    public static function paging(Request $request): array
    {
        $cursor = $request->query['cursor'] ?? null;
        $limit = $request->query['limit'] ?? null;
        $cursor = is_string($cursor) && $cursor !== '' && ctype_digit($cursor) ? (int) $cursor : null;
        $limit = is_string($limit) && ctype_digit($limit) ? max(1, min(200, (int) $limit)) : 50;

        return [$cursor, $limit];
    }

    public static function apiBase(Request $request, ?Config $config): string
    {
        return Config::apiBase($request->basePath, $config?->routingMode() ?? Config::ROUTING_REWRITE);
    }
}
