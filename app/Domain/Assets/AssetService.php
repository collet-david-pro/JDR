<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Users\User;

/**
 * Library operations on one asset: edit (name, kind, category, tags), soft delete with usages,
 * favorites, replay protection of uploads (client_op_id, table processed_ops).
 */
final class AssetService
{
    public function __construct(
        private Db $db,
        private Clock $clock,
        private AssetRepository $assets,
        private CategoryService $categories,
        private TagService $tags,
        private StorageQuota $quota,
    ) {
    }

    /**
     * @param array{name?: string, kind?: string, category_id?: ?int, tags?: list<string>} $changes validated
     */
    public function update(Asset $asset, array $changes): Asset
    {
        if (array_key_exists('category_id', $changes)) {
            $changes['category_id'] = $this->categories->requireUsable($changes['category_id'], $asset->ownerId);
        }
        $this->db->transaction(function () use ($asset, $changes): void {
            $this->assets->update($asset->id, $changes);
            if (isset($changes['tags'])) {
                $this->assets->setTags($asset->id, $this->tags->resolve($asset->ownerId, $changes['tags']));
            }
        });

        return $this->assets->find($asset->id) ?? $asset;
    }

    /**
     * @return array{maps: list<array{id: int, name: ?string}>, tokens: list<array{id: int, name: ?string}>}
     */
    public function usages(Asset $asset, User $viewer): array
    {
        return $this->assets->usages($asset->id, $viewer->id);
    }

    /**
     * Soft delete (projet.md 11.3): refused while used, unless $force; the bytes go back to the
     * owner's quota now, the files are deleted when the trash is purged.
     *
     * @return array{maps: list<array{id: int, name: ?string}>, tokens: list<array{id: int, name: ?string}>}|null
     *         the usages when refused, null when deleted
     */
    public function delete(Asset $asset, User $viewer, bool $force): ?array
    {
        $usages = $this->usages($asset, $viewer);
        if (!$force && ($usages['maps'] !== [] || $usages['tokens'] !== [])) {
            return $usages;
        }
        $this->db->transaction(function () use ($asset): void {
            if ($this->assets->softDelete($asset->id) && $asset->ownerId !== null) {
                $this->quota->release($asset->ownerId, $asset->storedBytes());
            }
        });

        return null;
    }

    public function setFavorite(User $user, Asset $asset, bool $favorite): void
    {
        $this->assets->setFavorite($user->id, $asset->id, $favorite);
    }

    /**
     * Normalized list of tag names (max 20, duplicates removed case-insensitively).
     *
     * @throws ValidationException tags invalid
     * @return list<string>
     */
    public static function tagNames(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > TagService::MAX_TAGS_PER_ASSET) {
            throw new ValidationException('', ['tags' => 'invalid']);
        }
        $names = [];
        foreach ($value as $raw) {
            $name = TagService::normalize($raw);
            if ($name === null) {
                throw new ValidationException('', ['tags' => 'invalid']);
            }
            $names[mb_strtolower($name, 'UTF-8')] ??= $name;
        }

        return array_values($names);
    }

    /**
     * Asset id and duplicate flag recorded for a replayed upload of this user, if any.
     *
     * @return array{asset_id: int, duplicate: bool}|null
     */
    public function replayed(User $user, string $clientOpId): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT `user_id`, `response` FROM ' . $this->db->t('processed_ops') . ' WHERE `client_op_id` = ?',
            [$clientOpId],
        );
        if ($row === null || (int) $row['user_id'] !== $user->id) {
            return null;
        }
        $data = json_decode((string) $row['response'], true);
        if (!is_array($data) || !is_int($data['asset_id'] ?? null)) {
            return null;
        }

        return ['asset_id' => $data['asset_id'], 'duplicate' => ($data['duplicate'] ?? false) === true];
    }

    public function remember(User $user, string $clientOpId, Asset $asset, bool $duplicate): void
    {
        $this->db->execute(
            'INSERT IGNORE INTO ' . $this->db->t('processed_ops') . ' (`client_op_id`, `user_id`, `response`, `created_at`) VALUES (?, ?, ?, ?)',
            [$clientOpId, $user->id, json_encode(['asset_id' => $asset->id, 'duplicate' => $duplicate]), $this->clock->sql()],
        );
    }
}
