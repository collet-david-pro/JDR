<?php

declare(strict_types=1);

namespace JDR\Domain\Encounters;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\Dates;

/**
 * Prepared encounter: tokens of the same game with offsets in cells (no stats, projet.md 2.2).
 */
final class Encounter
{
    /**
     * @param list<array{token_id: int, dx: int|float, dy: int|float}> $tokens
     */
    public function __construct(
        public readonly int $id,
        public readonly int $gameId,
        public readonly string $name,
        public readonly ?string $notes,
        public readonly array $tokens,
        public readonly string $createdAt,
        public readonly string $updatedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     * @param list<array{token_id: int, dx: int|float, dy: int|float}> $tokens
     */
    public static function fromRow(array $row, array $tokens): self
    {
        return new self(
            (int) $row['id'],
            (int) $row['game_id'],
            (string) $row['name'],
            $row['notes'] === null || $row['notes'] === '' ? null : (string) $row['notes'],
            $tokens,
            (string) $row['created_at'],
            (string) $row['updated_at'],
        );
    }

    /**
     * API representation "Encounter" (contract P3).
     *
     * @return array<string, mixed>
     */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'game_id' => $this->gameId,
            'name' => $this->name,
            'notes' => $this->notes,
            'tokens' => $this->tokens,
            'created_at' => Dates::iso($this->createdAt),
            'updated_at' => Dates::iso($this->updatedAt),
        ];
    }
}
