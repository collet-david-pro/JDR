<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * Finds the asset behind a portable palette reference ("sha256:<hex>", projet.md 12.1) on this
 * server: a live asset of the given user first, then a live asset of the general library.
 */
final class PaletteResolver
{
    public function __construct(private Db $db)
    {
    }

    /**
     * @param list<string> $hashes lowercase hex SHA-256
     * @return array<string, int> sha256 => asset id (only the hashes found)
     */
    public function resolve(int $userId, array $hashes): array
    {
        $hashes = array_values(array_unique($hashes));
        $found = [];
        foreach (array_chunk($hashes, 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id`, `sha256`, `owner_user_id` FROM ' . $this->db->t('assets') . ' WHERE `deleted_at` IS NULL '
                . 'AND (`owner_user_id` = ? OR `owner_user_id` IS NULL) AND `sha256` IN ('
                . implode(', ', array_fill(0, count($batch), '?')) . ') ORDER BY `id`',
                [$userId, ...$batch],
            );
            $general = [];
            foreach ($rows as $r) {
                $sha = strtolower((string) $r['sha256']);
                if ($r['owner_user_id'] === null) {
                    $general[$sha] ??= (int) $r['id'];
                } else {
                    $found[$sha] ??= (int) $r['id'];
                }
            }
            $found += $general;
        }

        return $found;
    }

    /**
     * Ids among $ids whose asset row still exists (any state).
     *
     * @param list<int> $ids
     * @return array<int, true>
     */
    public function existing(array $ids): array
    {
        $out = [];
        foreach (array_chunk(array_values(array_unique($ids)), 500) as $batch) {
            $rows = $this->db->fetchAll(
                'SELECT `id` FROM ' . $this->db->t('assets') . ' WHERE `id` IN (' . implode(', ', array_fill(0, count($batch), '?')) . ')',
                $batch,
            );
            foreach ($rows as $r) {
                $out[(int) $r['id']] = true;
            }
        }

        return $out;
    }
}
