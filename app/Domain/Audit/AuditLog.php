<?php

declare(strict_types=1);

namespace JDR\Domain\Audit;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Logger;
use JDR\Domain\Support\Dates;

/**
 * audit_log: every admin action and account deletion. Never stores secrets
 * (data goes through Logger::redact()).
 */
final class AuditLog
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * @param array<string, mixed>|null $data
     */
    public function record(
        ?int $userId,
        string $action,
        ?string $entity = null,
        ?int $entityId = null,
        ?array $data = null,
        ?string $ip = null,
    ): void {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('audit_log')
            . ' (`user_id`, `action`, `entity`, `entity_id`, `data`, `ip`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $userId,
                substr($action, 0, 50),
                $entity === null ? null : substr($entity, 0, 30),
                $entityId,
                $data === null ? null : json_encode(
                    Logger::redact($data),
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
                ),
                $ip === null || $ip === '' ? null : substr($ip, 0, 45),
                $this->clock->sql(),
            ],
        );
    }

    /**
     * Newest first, cursor = id of the last row of the previous page.
     *
     * @return array{items: list<array<string, mixed>>, next_cursor: string|null}
     */
    public function page(?int $cursor, int $limit): array
    {
        $params = [];
        $where = '';
        if ($cursor !== null) {
            $where = 'WHERE a.`id` < ? ';
            $params[] = $cursor;
        }
        $params[] = $limit + 1;
        $rows = $this->db->fetchAll(
            'SELECT a.`id`, a.`user_id`, u.`username`, a.`action`, a.`entity`, a.`entity_id`, a.`data`, a.`ip`, '
            . 'a.`created_at` FROM ' . $this->db->t('audit_log') . ' a LEFT JOIN ' . $this->db->t('users')
            . ' u ON u.`id` = a.`user_id` ' . $where . 'ORDER BY a.`id` DESC LIMIT ?',
            $params,
        );
        $next = null;
        if (count($rows) > $limit) {
            array_pop($rows);
            $next = (string) $rows[count($rows) - 1]['id'];
        }
        $items = [];
        foreach ($rows as $row) {
            $data = $row['data'] === null ? null : json_decode((string) $row['data'], true);
            $items[] = [
                'id' => (int) $row['id'],
                'user' => $row['user_id'] === null ? null : [
                    'id' => (int) $row['user_id'],
                    'username' => (string) ($row['username'] ?? ''),
                ],
                'action' => (string) $row['action'],
                'entity' => $row['entity'],
                'entity_id' => $row['entity_id'] === null ? null : (int) $row['entity_id'],
                'data' => $data,
                'ip' => $row['ip'],
                'created_at' => Dates::iso($row['created_at']),
            ];
        }

        return ['items' => $items, 'next_cursor' => $next];
    }

    /**
     * Account deletion: the user's own entries lose their author and IP, entries about the user
     * lose their data (e-mail, username).
     */
    public function anonymizeUser(int $userId): void
    {
        $t = $this->db->t('audit_log');
        $this->db->execute('UPDATE ' . $t . ' SET `user_id` = NULL, `ip` = NULL WHERE `user_id` = ?', [$userId]);
        $this->db->execute(
            'UPDATE ' . $t . " SET `data` = NULL WHERE `entity` = 'user' AND `entity_id` = ?",
            [$userId],
        );
    }

    /**
     * Entries written by a user (personal data export).
     *
     * @return list<array<string, mixed>>
     */
    public function byUser(int $userId, int $limit = 1000): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id`, `action`, `entity`, `entity_id`, `ip`, `created_at` FROM ' . $this->db->t('audit_log')
            . ' WHERE `user_id` = ? ORDER BY `id` DESC LIMIT ?',
            [$userId, $limit],
        );

        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'action' => (string) $r['action'],
            'entity' => $r['entity'],
            'entity_id' => $r['entity_id'] === null ? null : (int) $r['entity_id'],
            'ip' => $r['ip'],
            'created_at' => Dates::iso($r['created_at']),
        ], $rows);
    }
}
