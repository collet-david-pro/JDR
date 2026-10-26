<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Channel names (projet.md 10.1): "session:{id}" and "map:{id}".
 */
final class Channel
{
    public const SESSION = 'session';
    public const MAP = 'map';
    public const PATTERN = '/^(session|map):([1-9][0-9]{0,18})$/';
    /** Maximum number of channels in one subscription (contract P6a). */
    public const MAX_PER_REQUEST = 4;

    public static function session(int $id): string
    {
        return self::SESSION . ':' . $id;
    }

    public static function map(int $id): string
    {
        return self::MAP . ':' . $id;
    }

    /**
     * @return array{0: string, 1: int}|null [kind, id], null when the name is not a channel
     */
    public static function parse(string $channel): ?array
    {
        if (preg_match(self::PATTERN, $channel, $m) !== 1) {
            return null;
        }
        $id = filter_var($m[2], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id === false ? null : [$m[1], $id];
    }

    public static function isValid(string $channel): bool
    {
        return self::parse($channel) !== null;
    }
}
