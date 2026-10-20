<?php

declare(strict_types=1);

namespace JDR\Domain\Admin;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Users\UserRepository;

/**
 * Figures of the admin dashboard.
 */
final class AdminStats
{
    public function __construct(private Db $db, private UserRepository $users)
    {
    }

    /**
     * @return array{users: array{total: int, active: int, suspended: int, admins: int}, games: int, maps: int,
     *     storage_bytes: int, active_sessions: int}
     */
    public function compute(): array
    {
        $users = $this->users->stats();

        return [
            'users' => [
                'total' => $users['total'],
                'active' => $users['active'],
                'suspended' => $users['suspended'],
                'admins' => $users['admins'],
            ],
            'games' => (int) $this->db->fetchValue(
                'SELECT COUNT(*) FROM ' . $this->db->t('games') . ' WHERE `deleted_at` IS NULL',
            ),
            'maps' => (int) $this->db->fetchValue(
                'SELECT COUNT(*) FROM ' . $this->db->t('maps') . ' WHERE `deleted_at` IS NULL',
            ),
            'storage_bytes' => $users['storage_bytes'],
            'active_sessions' => (int) $this->db->fetchValue(
                'SELECT COUNT(*) FROM ' . $this->db->t('play_sessions') . " WHERE `state` <> 'ended'",
            ),
        ];
    }
}
