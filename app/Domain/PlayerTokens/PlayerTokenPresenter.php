<?php

declare(strict_types=1);

namespace JDR\Domain\PlayerTokens;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Support\Dates;

/**
 * API representation of a token of the personal collection (owner only: signed image URLs).
 */
final class PlayerTokenPresenter
{
    public function __construct(private AssetUrls $urls)
    {
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function one(array $row, string $apiBase): array
    {
        $design = json_decode((string) $row['design'], true);
        $image = ($row['asset_uuid'] ?? null) !== null && ($row['asset_deleted_at'] ?? null) === null ? (string) $row['asset_uuid'] : null;
        $source = ($row['source_uuid'] ?? null) !== null && ($row['source_deleted_at'] ?? null) === null ? (string) $row['source_uuid'] : null;

        return [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'image' => $image === null ? null : $this->urls->pair($apiBase, $image),
            'source_image' => $source === null ? null : $this->urls->pair($apiBase, $source),
            'design' => is_array($design) && $design !== [] ? $design : new \stdClass(),
            'games_count' => (int) ($row['games_count'] ?? 0),
            'created_at' => Dates::iso((string) $row['created_at']),
            'updated_at' => Dates::iso((string) $row['updated_at']),
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    public function many(array $rows, string $apiBase): array
    {
        return array_map(fn (array $r): array => $this->one($r, $apiBase), $rows);
    }
}
