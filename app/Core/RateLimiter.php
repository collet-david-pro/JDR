<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Rate limiting on the rate_limits table (projet.md 6.4): one row per bucket
 * (hits, window_start, blocked_until).
 *
 * - attempt(): counts a request, refused once more than "limit" requests fall in the window
 *   (the window restarts with the first request after it ends);
 * - hit(): records a failure; from "limit" failures on, the bucket is blocked for a growing delay
 *   (60 s, 120 s, 240 s... capped at 1 h) — used for failed logins;
 * - tooMany() / clear(): check / reset a bucket.
 */
final class RateLimiter
{
    /** Named buckets: limit per window (seconds). */
    public const BUCKETS = [
        'login' => ['limit' => 5, 'window' => 900],
        'register' => ['limit' => 5, 'window' => 3600],
        'join' => ['limit' => 10, 'window' => 60],
        'pair' => ['limit' => 10, 'window' => 60],
        'upload' => ['limit' => 60, 'window' => 3600],
        'forgot' => ['limit' => 3, 'window' => 3600],
        'actions' => ['limit' => 30, 'window' => 1],
    ];

    public const BASE_BLOCK_SECONDS = 60;
    public const MAX_BLOCK_SECONDS = 3600;

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * @return array{limit: int, window: int}
     */
    public static function definition(string $name): array
    {
        if (!isset(self::BUCKETS[$name])) {
            throw new \InvalidArgumentException('Unknown rate limit bucket: ' . $name);
        }

        return self::BUCKETS[$name];
    }

    /**
     * Bucket key "name:part1:part2", hashed when longer than the column (191).
     */
    public static function key(string $name, string ...$parts): string
    {
        $parts = array_map(static fn (string $p): string => mb_strtolower(trim($p), 'UTF-8'), $parts);
        $key = $name . ':' . implode(':', $parts);
        if (strlen($key) > 191) {
            $key = $name . ':h:' . hash('sha256', implode("\0", $parts));
        }

        return $key;
    }

    /**
     * Counts one request. Returns null when allowed, else the seconds to wait (Retry-After).
     */
    public function attempt(string $bucket, int $limit, int $window): ?int
    {
        return $this->db->transaction(function (Db $db) use ($bucket, $limit, $window): ?int {
            $now = $this->clock->timestamp();
            [$hits, $start, $blocked] = $this->lockRow($db, $bucket, $now);
            if ($blocked !== null && $blocked > $now) {
                return $blocked - $now;
            }
            if ($now >= $start + $window) {
                $hits = 0;
                $start = $now;
            }
            $hits++;
            $this->save($db, $bucket, $hits, $start, null);

            return $hits > $limit ? max(1, $start + $window - $now) : null;
        });
    }

    /**
     * Records a failure. Returns the blocking delay in seconds once the limit is reached, else null.
     */
    public function hit(string $bucket, int $limit, int $window): ?int
    {
        return $this->db->transaction(function (Db $db) use ($bucket, $limit, $window): ?int {
            $now = $this->clock->timestamp();
            [$hits, $start, $blocked] = $this->lockRow($db, $bucket, $now);
            $isBlocked = $blocked !== null && $blocked > $now;
            if (!$isBlocked && $now >= $start + $window) {
                $hits = 0;
                $start = $now;
            }
            $hits++;
            $delay = null;
            $blockedUntil = $isBlocked ? $blocked : null;
            if ($hits >= $limit) {
                $delay = (int) min(self::MAX_BLOCK_SECONDS, self::BASE_BLOCK_SECONDS * 2 ** min(20, $hits - $limit));
                $blockedUntil = $now + $delay;
                $start = $now;
            }
            $this->save($db, $bucket, $hits, $start, $blockedUntil);

            return $delay;
        });
    }

    /**
     * Seconds left while the bucket is blocked, else null.
     */
    public function tooMany(string $bucket): ?int
    {
        $blocked = $this->db->fetchValue(
            'SELECT `blocked_until` FROM ' . $this->db->t('rate_limits') . ' WHERE `bucket` = ?',
            [$bucket],
        );
        if (!is_string($blocked)) {
            return null;
        }
        $left = self::ts($blocked) - $this->clock->timestamp();

        return $left > 0 ? $left : null;
    }

    public function clear(string $bucket): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('rate_limits') . ' WHERE `bucket` = ?', [$bucket]);
    }

    /**
     * Deletes buckets idle for more than a day and not blocked (cron).
     */
    public function purge(): int
    {
        $limit = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - 86400);

        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('rate_limits')
            . ' WHERE `window_start` < ? AND (`blocked_until` IS NULL OR `blocked_until` < ?)',
            [$limit, $this->clock->sql()],
        );
    }

    /**
     * @return array{0: int, 1: int, 2: int|null} hits, window start, blocked until
     */
    private function lockRow(Db $db, string $bucket, int $now): array
    {
        $table = $db->t('rate_limits');
        $db->execute(
            'INSERT IGNORE INTO ' . $table . ' (`bucket`, `hits`, `window_start`) VALUES (?, 0, ?)',
            [$bucket, gmdate('Y-m-d H:i:s', $now)],
        );
        $row = $db->fetchOne(
            'SELECT `hits`, `window_start`, `blocked_until` FROM ' . $table . ' WHERE `bucket` = ? FOR UPDATE',
            [$bucket],
        ) ?? ['hits' => 0, 'window_start' => gmdate('Y-m-d H:i:s', $now), 'blocked_until' => null];

        return [
            (int) $row['hits'],
            self::ts((string) $row['window_start']),
            is_string($row['blocked_until']) ? self::ts($row['blocked_until']) : null,
        ];
    }

    private function save(Db $db, string $bucket, int $hits, int $start, ?int $blockedUntil): void
    {
        $db->execute(
            'UPDATE ' . $db->t('rate_limits') . ' SET `hits` = ?, `window_start` = ?, `blocked_until` = ? '
            . 'WHERE `bucket` = ?',
            [
                min($hits, 4294967295),
                gmdate('Y-m-d H:i:s', $start),
                $blockedUntil === null ? null : gmdate('Y-m-d H:i:s', $blockedUntil),
                $bucket,
            ],
        );
    }

    private static function ts(string $datetime): int
    {
        $dt = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $datetime, new \DateTimeZone('UTC'));

        return $dt === false ? 0 : $dt->getTimestamp();
    }
}
