<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Response;

/**
 * SQL access to session_displays. No right check here (see DisplayService / DisplayAuth).
 */
final class DisplayRepository
{
    private const COLUMNS = 'd.`id`, d.`session_id`, d.`name`, d.`pairing_expires_at`, d.`state`, d.`settings`, d.`last_ip`, '
        . 'd.`user_agent`, d.`paired_at`, d.`last_seen_at`, d.`created_at`';

    public function __construct(private Db $db)
    {
    }

    public function db(): Db
    {
        return $this->db;
    }

    public function find(int $id, bool $lock = false): ?Display
    {
        return $this->one('d.`id` = ?', [$id], $lock);
    }

    public function findByTokenHash(string $hash): ?Display
    {
        return $this->one('d.`device_token_hash` = ?', [$hash], false);
    }

    public function countForSession(int $sessionId): int
    {
        return (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('session_displays') . ' WHERE `session_id` = ?', [$sessionId]);
    }

    /**
     * @param array<string, mixed> $settings
     */
    public function insert(int $sessionId, string $name, string $codeHash, string $expiresAt, array $settings, string $now): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('session_displays') . ' (`session_id`, `name`, `pairing_code_hash`, `pairing_expires_at`, '
            . '`state`, `settings`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$sessionId, $name, $codeHash, $expiresAt, Display::PENDING, json_encode($settings, Response::JSON_FLAGS), $now],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $fields among name, settings (array), session_id, pairing_code_hash, pairing_expires_at,
     *                                     device_token_hash, state, last_ip, user_agent, paired_at, last_seen_at
     */
    public function update(int $id, array $fields): void
    {
        $allowed = array_intersect_key($fields, array_flip([
            'name', 'settings', 'session_id', 'pairing_code_hash', 'pairing_expires_at', 'device_token_hash', 'state',
            'last_ip', 'user_agent', 'paired_at', 'last_seen_at',
        ]));
        if ($allowed === []) {
            return;
        }
        $sets = [];
        $params = [];
        foreach ($allowed as $column => $value) {
            $sets[] = '`' . $column . '` = ?';
            $params[] = is_array($value) ? json_encode($value, Response::JSON_FLAGS) : $value;
        }
        $params[] = $id;
        $this->db->execute('UPDATE ' . $this->db->t('session_displays') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
    }

    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('session_displays') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * @return list<Display> creation order
     */
    public function listForSession(int $sessionId): array
    {
        return $this->many('d.`session_id` = ? ORDER BY d.`id`', [$sessionId]);
    }

    /**
     * Pending screens whose code has not expired, site wide: [display id, code hash].
     *
     * @return list<array{id: int, hash: string}>
     */
    public function pendingCodes(string $now, bool $lock = false): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id`, `pairing_code_hash` FROM ' . $this->db->t('session_displays')
            . " WHERE `state` = 'pending' AND `pairing_code_hash` IS NOT NULL AND `pairing_expires_at` > ?" . ($lock ? ' FOR UPDATE' : ''),
            [$now],
        );

        return array_map(static fn (array $r): array => ['id' => (int) $r['id'], 'hash' => (string) $r['pairing_code_hash']], $rows);
    }

    /**
     * @param list<mixed> $params
     */
    private function one(string $where, array $params, bool $lock): ?Display
    {
        $row = $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('session_displays') . ' d WHERE ' . $where . ($lock ? ' FOR UPDATE' : ''),
            $params,
        );

        return $row === null ? null : Display::fromRow($row);
    }

    /**
     * @param list<mixed> $params
     * @return list<Display>
     */
    private function many(string $tail, array $params): array
    {
        $rows = $this->db->fetchAll(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('session_displays') . ' d JOIN ' . $this->db->t('play_sessions')
            . ' s ON s.`id` = d.`session_id` WHERE ' . $tail,
            $params,
        );

        return array_map(Display::fromRow(...), $rows);
    }
}
