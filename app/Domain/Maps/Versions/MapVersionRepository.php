<?php

declare(strict_types=1);

namespace JDR\Domain\Maps\Versions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to map_versions (projet.md 7.2). The snapshot column holds the gzip-compressed
 * JSON document (12.1, internal form); it is only read for a restore.
 */
final class MapVersionRepository
{
    public const LIST_LIMIT = 500;
    private const COLUMNS = 'v.`id`, v.`map_id`, v.`revision`, v.`kind`, v.`label`, v.`size_bytes`, v.`created_by`, v.`created_at`';

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * Versions of a map, most recent first, with the author's username.
     *
     * @return list<array<string, mixed>>
     */
    public function listForMap(int $mapId): array
    {
        return $this->db->fetchAll(
            'SELECT ' . self::COLUMNS . ', u.`username` FROM ' . $this->db->t('map_versions') . ' v LEFT JOIN '
            . $this->db->t('users') . ' u ON u.`id` = v.`created_by` WHERE v.`map_id` = ? '
            . 'ORDER BY v.`created_at` DESC, v.`id` DESC LIMIT ' . self::LIST_LIMIT,
            [$mapId],
        );
    }

    /**
     * One version of a map (metadata), null when absent or of another map.
     *
     * @return array<string, mixed>|null
     */
    public function find(int $mapId, int $versionId): ?array
    {
        return $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ', u.`username` FROM ' . $this->db->t('map_versions') . ' v LEFT JOIN '
            . $this->db->t('users') . ' u ON u.`id` = v.`created_by` WHERE v.`map_id` = ? AND v.`id` = ?',
            [$mapId, $versionId],
        );
    }

    public function snapshot(int $versionId): ?string
    {
        $value = $this->db->fetchValue('SELECT `snapshot` FROM ' . $this->db->t('map_versions') . ' WHERE `id` = ?', [$versionId]);

        return is_string($value) ? $value : null;
    }

    public function replaceSnapshot(int $versionId, string $snapshot): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_versions') . ' SET `snapshot` = ?, `size_bytes` = ? WHERE `id` = ?',
            [$snapshot, strlen($snapshot), $versionId],
        );
    }

    public function insert(int $mapId, int $revision, string $kind, ?string $label, string $snapshot, ?int $userId): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_versions') . ' (`map_id`, `revision`, `kind`, `label`, `snapshot`, `size_bytes`, '
            . '`created_by`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$mapId, $revision, $kind, $label, $snapshot, strlen($snapshot), $userId, $this->clock->sql()],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * Most recent version of a kind: {revision, created_at} or null.
     *
     * @return array{revision: int, created_at: string}|null
     */
    public function latest(int $mapId, string $kind): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT `revision`, `created_at` FROM ' . $this->db->t('map_versions') . ' WHERE `map_id` = ? AND `kind` = ? '
            . 'ORDER BY `created_at` DESC, `id` DESC LIMIT 1',
            [$mapId, $kind],
        );

        return $row === null ? null : ['revision' => (int) $row['revision'], 'created_at' => (string) $row['created_at']];
    }

    // ---- Retention -------------------------------------------------------------------------

    /**
     * Maps holding versions to delete: non-manual, non-auto versions older than $before, or more
     * than $keepAuto auto versions with at least one older than $before (then the oldest auto is
     * both old and beyond the kept ones).
     *
     * @return list<int>
     */
    public function mapsToTrim(string $before, int $keepAuto, int $limit): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `map_id` FROM ' . $this->db->t('map_versions') . ' GROUP BY `map_id` HAVING '
            . "SUM(`kind` NOT IN ('auto', 'manual') AND `created_at` < ?) > 0 "
            . "OR (SUM(`kind` = 'auto') > ? AND SUM(`kind` = 'auto' AND `created_at` < ?) > 0) "
            . 'ORDER BY `map_id` LIMIT ' . max(1, $limit),
            [$before, $keepAuto, $before],
        );

        return array_map(static fn (array $r): int => (int) $r['map_id'], $rows);
    }

    /**
     * Deletes the versions of a map that the retention does not keep: every manual version and
     * every version newer than $before are kept, plus the $keepAuto most recent auto versions.
     */
    public function trim(int $mapId, string $before, int $keepAuto): int
    {
        $keep = array_map(static fn (array $r): int => (int) $r['id'], $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('map_versions') . " WHERE `map_id` = ? AND `kind` = 'auto' "
            . 'ORDER BY `created_at` DESC, `id` DESC LIMIT ' . max(0, $keepAuto),
            [$mapId],
        ));
        $sql = 'DELETE FROM ' . $this->db->t('map_versions') . " WHERE `map_id` = ? AND `kind` <> 'manual' AND `created_at` < ?";
        $params = [$mapId, $before];
        if ($keep !== []) {
            $sql .= ' AND `id` NOT IN (' . implode(', ', array_fill(0, count($keep), '?')) . ')';
            $params = [...$params, ...$keep];
        }

        return $this->db->execute($sql, $params);
    }
}
