<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * PHP session handler on the php_sessions table (settings.use_db_sessions), for hosts whose
 * session.save_path is shared or unreliable. Strict mode is supported (validateId), and a
 * per-session MySQL named lock emulates the file handler's locking.
 */
final class DbSessionHandler implements \SessionHandlerInterface, \SessionUpdateTimestampHandlerInterface
{
    private const LOCK_TIMEOUT = 10;

    private ?string $lockName = null;
    private ?int $userId = null;

    public function __construct(private Db $db, private Clock $clock, private string $ip = '')
    {
    }

    /**
     * Owner of the session, stored in php_sessions.user_id on the next write.
     */
    public function setUserId(?int $userId): void
    {
        $this->userId = $userId;
    }

    public function open(string $path, string $name): bool
    {
        return true;
    }

    public function close(): bool
    {
        $this->releaseLock();

        return true;
    }

    public function read(string $id): string|false
    {
        $this->acquireLock($id);
        $data = $this->db->fetchValue(
            'SELECT `data` FROM ' . $this->db->t('php_sessions') . ' WHERE `id` = ? AND `last_activity` >= ?',
            [$id, $this->clock->timestamp() - $this->maxLifetime()],
        );

        return is_string($data) ? $data : '';
    }

    public function write(string $id, string $data): bool
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('php_sessions') . ' (`id`, `user_id`, `data`, `ip`, `last_activity`) '
            . 'VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`), '
            . '`data` = VALUES(`data`), `ip` = VALUES(`ip`), `last_activity` = VALUES(`last_activity`)',
            [$id, $this->userId, $data, $this->ip === '' ? null : substr($this->ip, 0, 45), $this->clock->timestamp()],
        );

        return true;
    }

    public function destroy(string $id): bool
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('php_sessions') . ' WHERE `id` = ?', [$id]);

        return true;
    }

    public function gc(int $max_lifetime): int|false
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('php_sessions') . ' WHERE `last_activity` < ?',
            [$this->clock->timestamp() - $max_lifetime],
        );
    }

    public function validateId(string $id): bool
    {
        return $this->db->fetchValue(
            'SELECT 1 FROM ' . $this->db->t('php_sessions') . ' WHERE `id` = ? AND `last_activity` >= ?',
            [$id, $this->clock->timestamp() - $this->maxLifetime()],
        ) !== null;
    }

    public function updateTimestamp(string $id, string $data): bool
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('php_sessions') . ' SET `last_activity` = ? WHERE `id` = ?',
            [$this->clock->timestamp(), $id],
        );

        return true;
    }

    /**
     * Deletes every session of a user (suspension, deletion).
     */
    public function destroyUser(int $userId): int
    {
        return $this->db->execute('DELETE FROM ' . $this->db->t('php_sessions') . ' WHERE `user_id` = ?', [$userId]);
    }

    private function maxLifetime(): int
    {
        return max(1440, (int) ini_get('session.gc_maxlifetime'));
    }

    private function acquireLock(string $id): void
    {
        $this->releaseLock();
        $name = 'jdr_sess_' . substr(hash('sha256', $this->db->prefix() . $id), 0, 40);
        $got = $this->db->fetchValue('SELECT GET_LOCK(?, ?)', [$name, self::LOCK_TIMEOUT]);
        if ((int) $got === 1) {
            $this->lockName = $name;
        }
    }

    private function releaseLock(): void
    {
        if ($this->lockName !== null) {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$this->lockName]);
            $this->lockName = null;
        }
    }
}
