<?php

declare(strict_types=1);

namespace JDR\Domain\Encounters;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to encounters and encounter_tokens (only live tokens are listed).
 */
final class EncounterRepository
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function find(int $id): ?Encounter
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('encounters') . ' WHERE `id` = ?', [$id]);

        return $row === null ? null : Encounter::fromRow($row, $this->tokensOf([(int) $row['id']])[(int) $row['id']] ?? []);
    }

    /**
     * @return list<Encounter>
     */
    public function listForGame(int $gameId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . $this->db->t('encounters') . ' WHERE `game_id` = ? ORDER BY `name`, `id` LIMIT 1000',
            [$gameId],
        );
        $tokens = $this->tokensOf(array_map(static fn (array $r): int => (int) $r['id'], $rows));

        return array_map(static fn (array $r): Encounter => Encounter::fromRow($r, $tokens[(int) $r['id']] ?? []), $rows);
    }

    /**
     * @param list<array{token_id: int, dx: int|float, dy: int|float}> $tokens
     */
    public function insert(int $gameId, string $name, ?string $notes, array $tokens): int
    {
        return (int) $this->db->transaction(function () use ($gameId, $name, $notes, $tokens): int {
            $now = $this->clock->sql();
            $this->db->execute(
                'INSERT INTO ' . $this->db->t('encounters') . ' (`game_id`, `name`, `notes`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?)',
                [$gameId, $name, $notes, $now, $now],
            );
            $id = (int) $this->db->lastInsertId();
            $this->writeTokens($id, $tokens);

            return $id;
        });
    }

    /**
     * @param array{name?: string, notes?: ?string, tokens?: list<array{token_id: int, dx: int|float, dy: int|float}>} $changes
     */
    public function update(int $id, array $changes): void
    {
        $this->db->transaction(function () use ($id, $changes): void {
            $sets = [];
            $params = [];
            foreach (['name', 'notes'] as $column) {
                if (array_key_exists($column, $changes)) {
                    $sets[] = '`' . $column . '` = ?';
                    $params[] = $changes[$column];
                }
            }
            $sets[] = '`updated_at` = ?';
            $params[] = $this->clock->sql();
            $params[] = $id;
            $this->db->execute('UPDATE ' . $this->db->t('encounters') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
            if (isset($changes['tokens'])) {
                $this->db->execute('DELETE FROM ' . $this->db->t('encounter_tokens') . ' WHERE `encounter_id` = ?', [$id]);
                $this->writeTokens($id, $changes['tokens']);
            }
        });
    }

    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('encounters') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * @param list<array{token_id: int, dx: int|float, dy: int|float}> $tokens
     */
    private function writeTokens(int $encounterId, array $tokens): void
    {
        foreach ($tokens as $token) {
            $this->db->execute(
                'INSERT INTO ' . $this->db->t('encounter_tokens') . ' (`encounter_id`, `token_id`, `dx`, `dy`) VALUES (?, ?, ?, ?)',
                [$encounterId, $token['token_id'], $token['dx'], $token['dy']],
            );
        }
    }

    /**
     * @param list<int> $encounterIds
     * @return array<int, list<array{token_id: int, dx: int|float, dy: int|float}>>
     */
    private function tokensOf(array $encounterIds): array
    {
        if ($encounterIds === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT e.`encounter_id`, e.`token_id`, e.`dx`, e.`dy` FROM ' . $this->db->t('encounter_tokens') . ' e '
            . 'INNER JOIN ' . $this->db->t('tokens') . ' t ON t.`id` = e.`token_id` AND t.`deleted_at` IS NULL '
            . 'WHERE e.`encounter_id` IN (' . implode(', ', array_fill(0, count($encounterIds), '?')) . ') '
            . 'ORDER BY e.`encounter_id`, e.`token_id`',
            $encounterIds,
        );
        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['encounter_id']][] = [
                'token_id' => (int) $row['token_id'],
                'dx' => self::number((float) $row['dx']),
                'dy' => self::number((float) $row['dy']),
            ];
        }

        return $out;
    }

    private static function number(float $value): int|float
    {
        return floor($value) === $value ? (int) $value : $value;
    }
}
