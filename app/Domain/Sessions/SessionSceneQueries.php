<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * Read-only SQL used by the player views of a session (fog_strict scope, preload, D11 access).
 */
final class SessionSceneQueries
{
    public function __construct(private Db $db)
    {
    }

    /**
     * Explored fog blocks of a map: floor id => ["cx:cy" => true].
     *
     * @return array<int, array<string, true>>
     */
    public function fogBlocks(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `floor_id`, `cx`, `cy` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ?',
            [$mapId],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['floor_id']][(int) $r['cx'] . ':' . (int) $r['cy']] = true;
        }

        return $out;
    }

    /**
     * Placed tokens of a map that are assigned in the session and not hidden (a hidden token is
     * not shown to its owner either: its position must not widen his scope), with their
     * definition's vision.
     *
     * @return list<array{user_id: int, floor_id: int, x: float, y: float, vision: array<string, mixed>}>
     */
    public function assignedPlaced(int $sessionId, int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT ta.`user_id`, mt.`floor_id`, mt.`x`, mt.`y`, t.`vision` FROM ' . $this->db->t('map_tokens') . ' mt '
            . 'JOIN ' . $this->db->t('token_assignments') . ' ta ON ta.`token_id` = mt.`token_id` AND ta.`session_id` = ? '
            . 'JOIN ' . $this->db->t('tokens') . ' t ON t.`id` = mt.`token_id` '
            . 'WHERE mt.`map_id` = ? AND mt.`hidden` = 0',
            [$sessionId, $mapId],
        );
        $out = [];
        foreach ($rows as $r) {
            $vision = json_decode((string) $r['vision'], true);
            $out[] = [
                'user_id' => (int) $r['user_id'],
                'floor_id' => (int) $r['floor_id'],
                'x' => (float) $r['x'],
                'y' => (float) $r['y'],
                'vision' => is_array($vision) ? $vision : [],
            ];
        }

        return $out;
    }

    /**
     * The open session (running or paused) of $userId, as a non-kicked player, whose current map
     * is $mapId; null when there is none.
     */
    public function playerSessionForMap(int $userId, int $mapId): ?int
    {
        $id = $this->db->fetchValue(
            'SELECT s.`id` FROM ' . $this->db->t('play_sessions') . ' s '
            . 'JOIN ' . $this->db->t('session_players') . " p ON p.`session_id` = s.`id` AND p.`user_id` = ? AND p.`status` <> 'kicked' "
            . "WHERE s.`current_map_id` = ? AND s.`state` IN ('running', 'paused') ORDER BY s.`id` DESC LIMIT 1",
            [$userId, $mapId],
        );

        return $id === null ? null : (int) $id;
    }

    /**
     * Live assets by id: id => {uuid, kind, bytes}.
     *
     * @param list<int> $ids
     * @return array<int, array{uuid: string, kind: string, bytes: int}>
     */
    public function assets(array $ids): array
    {
        $out = [];
        foreach (array_chunk(array_values(array_unique($ids)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id`, `uuid`, `kind`, `size_bytes` FROM ' . $this->db->t('assets') . ' WHERE `deleted_at` IS NULL AND `id` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ')',
                $batch,
            );
            foreach ($rows as $r) {
                $out[(int) $r['id']] = ['uuid' => (string) $r['uuid'], 'kind' => (string) $r['kind'], 'bytes' => (int) $r['size_bytes']];
            }
        }

        return $out;
    }
}
