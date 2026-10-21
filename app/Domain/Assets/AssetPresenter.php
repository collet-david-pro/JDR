<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\Dates;
use JDR\Domain\Users\User;

/**
 * API representation "Asset" (contract P2), with signed URLs. Only call for assets the viewer may see.
 */
final class AssetPresenter
{
    public function __construct(private AssetRepository $assets, private AssetUrls $urls)
    {
    }

    /**
     * @param list<Asset> $assets
     * @return list<array<string, mixed>>
     */
    public function many(array $assets, User $viewer, string $apiBase): array
    {
        $ids = array_map(static fn (Asset $a): int => $a->id, $assets);
        $tags = $this->assets->tagsFor($ids);
        $favorites = $this->assets->favoritesOf($viewer->id, $ids);
        $out = [];
        foreach ($assets as $asset) {
            $out[] = [
                'id' => $asset->id,
                'uuid' => $asset->uuid,
                'name' => $asset->name,
                'kind' => $asset->kind,
                'mime' => $asset->mime,
                'width' => $asset->width,
                'height' => $asset->height,
                'is_animated' => $asset->isAnimated,
                'frame_count' => $asset->frameCount,
                'duration_ms' => $asset->durationMs,
                'size_bytes' => $asset->sizeBytes,
                'scope' => $asset->scope(),
                'owner_id' => $asset->ownerId,
                'category_id' => $asset->categoryId,
                'tags' => $tags[$asset->id] ?? [],
                'favorite' => isset($favorites[$asset->id]),
                'source' => $asset->source,
                'created_at' => Dates::iso($asset->createdAt),
                'urls' => $this->urls->pair($apiBase, $asset->uuid),
            ];
        }

        return $out;
    }

    /**
     * @return array<string, mixed>
     */
    public function one(Asset $asset, User $viewer, string $apiBase): array
    {
        return $this->many([$asset], $viewer, $apiBase)[0];
    }
}
