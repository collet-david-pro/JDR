<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * login_attempts journal (kept 30 days, purged by the cron tasks).
 */
final class LoginAttempts
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function record(string $identifier, string $ip, bool $success): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('login_attempts') . ' (`identifier`, `ip`, `success`, `created_at`) '
            . 'VALUES (?, ?, ?, ?)',
            [
                mb_substr(mb_strtolower(trim($identifier), 'UTF-8'), 0, 191, 'UTF-8'),
                substr($ip, 0, 45),
                $success ? 1 : 0,
                $this->clock->sql(),
            ],
        );
    }

    public function purge(int $days = 30): int
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('login_attempts') . ' WHERE `created_at` < ?',
            [gmdate('Y-m-d H:i:s', $this->clock->timestamp() - $days * 86400)],
        );
    }
}
