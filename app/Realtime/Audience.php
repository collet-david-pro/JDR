<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Event audiences and reader roles (projet.md 10.2):
 * - gm (GM / co-GM) reads everything;
 * - player reads all, players and user = himself;
 * - display (projection screen, P7) reads all and displays.
 */
final class Audience
{
    public const ALL = 'all';
    public const GM = 'gm';
    public const PLAYERS = 'players';
    public const DISPLAYS = 'displays';
    public const USER = 'user';
    public const VALUES = [self::ALL, self::GM, self::PLAYERS, self::DISPLAYS, self::USER];

    public const ROLE_GM = 'gm';
    public const ROLE_PLAYER = 'player';
    public const ROLE_DISPLAY = 'display';

    /**
     * May a reader of $role (user $userId) see an event of $audience (target $audienceUserId)?
     */
    public static function allows(string $role, ?int $userId, string $audience, ?int $audienceUserId): bool
    {
        return match ($role) {
            self::ROLE_GM => true,
            self::ROLE_PLAYER => $audience === self::ALL || $audience === self::PLAYERS
                || ($audience === self::USER && $userId !== null && $audienceUserId === $userId),
            self::ROLE_DISPLAY => $audience === self::ALL || $audience === self::DISPLAYS,
            default => false,
        };
    }

    /**
     * SQL condition on the columns `audience` / `audience_user_id` of alias $a for a reader.
     *
     * @return array{0: string, 1: list<int|string>} [sql, params]
     */
    public static function sql(string $a, string $role, ?int $userId): array
    {
        return match ($role) {
            self::ROLE_GM => ['1=1', []],
            self::ROLE_PLAYER => $userId === null
                ? [$a . '.`audience` IN (?, ?)', [self::ALL, self::PLAYERS]]
                : [
                    '(' . $a . '.`audience` IN (?, ?) OR (' . $a . '.`audience` = ? AND ' . $a . '.`audience_user_id` = ?))',
                    [self::ALL, self::PLAYERS, self::USER, $userId],
                ],
            self::ROLE_DISPLAY => [$a . '.`audience` IN (?, ?)', [self::ALL, self::DISPLAYS]],
            default => ['1=0', []],
        };
    }
}
