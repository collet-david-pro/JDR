<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Domain\Settings\Settings;

/**
 * users.storage_used_bytes, maintained atomically (projet.md 7.2 note).
 * General assets consume nobody's quota.
 */
final class StorageQuota
{
    public function __construct(private Db $db, private Settings $settings)
    {
    }

    /**
     * Reserves $bytes for $userId (call inside the insertion transaction).
     *
     * @throws PayloadTooLargeException 413 quota_exceeded
     */
    public function reserve(int $userId, int $bytes): void
    {
        if ($bytes <= 0) {
            return;
        }
        $affected = $this->db->execute(
            'UPDATE ' . $this->db->t('users') . ' SET `storage_used_bytes` = `storage_used_bytes` + :n '
            . 'WHERE `id` = :id AND `storage_used_bytes` + :n2 <= COALESCE(`storage_quota_bytes`, :default)',
            ['n' => $bytes, 'n2' => $bytes, 'id' => $userId, 'default' => $this->settings->int('default_quota_bytes')],
        );
        if ($affected === 0) {
            throw new PayloadTooLargeException('', [], 'quota_exceeded');
        }
    }

    public function release(int $userId, int $bytes): void
    {
        if ($bytes <= 0) {
            return;
        }
        $this->db->execute(
            'UPDATE ' . $this->db->t('users') . ' SET `storage_used_bytes` = `storage_used_bytes` - LEAST(`storage_used_bytes`, ?) '
            . 'WHERE `id` = ?',
            [$bytes, $userId],
        );
    }

    /**
     * @return array{used_bytes: int, quota_bytes: int}
     */
    public function usage(int $userId): array
    {
        $row = $this->db->fetchOne(
            'SELECT `storage_used_bytes`, `storage_quota_bytes` FROM ' . $this->db->t('users') . ' WHERE `id` = ?',
            [$userId],
        );

        return [
            'used_bytes' => (int) ($row['storage_used_bytes'] ?? 0),
            'quota_bytes' => ($row['storage_quota_bytes'] ?? null) === null
                ? $this->settings->int('default_quota_bytes')
                : (int) $row['storage_quota_bytes'],
        ];
    }
}
