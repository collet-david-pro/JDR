<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Users\User;

/**
 * Asset categories: personal (owner_user_id = user) and general (NULL, admins only), as a tree
 * (parent_id, same scope). Category {id, name, parent_id, sort_order, scope}.
 */
final class CategoryService
{
    public const MAX_DEPTH = 8;

    public function __construct(private Db $db, private AssetPolicy $policy)
    {
    }

    /**
     * Own personal categories and the general ones, in one list.
     *
     * @return list<array<string, mixed>>
     */
    public function list(User $user): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . $this->db->t('asset_categories') . ' WHERE `owner_user_id` IS NULL OR `owner_user_id` = ? '
            . 'ORDER BY (`owner_user_id` IS NULL) DESC, `sort_order`, `name`, `id`',
            [$user->id],
        );

        return array_map([self::class, 'present'], $rows);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function present(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'parent_id' => $row['parent_id'] === null ? null : (int) $row['parent_id'],
            'sort_order' => (int) $row['sort_order'],
            'scope' => $row['owner_user_id'] === null ? Asset::SCOPE_GENERAL : Asset::SCOPE_PERSONAL,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(int $id): ?array
    {
        return $this->db->fetchOne('SELECT * FROM ' . $this->db->t('asset_categories') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * @return array<string, mixed>
     */
    public function create(User $user, string $name, ?int $parentId, string $scope): array
    {
        $owner = $this->policy->ownerFor($user, $scope);
        if ($parentId !== null) {
            $this->checkParent($owner, null, $parentId);
        }
        $t = $this->db->t('asset_categories');
        $order = (int) $this->db->fetchValue(
            'SELECT COALESCE(MAX(`sort_order`), -1) + 1 FROM ' . $t . ' WHERE '
            . ($owner === null ? '`owner_user_id` IS NULL' : '`owner_user_id` = ?')
            . ($parentId === null ? ' AND `parent_id` IS NULL' : ' AND `parent_id` = ?'),
            array_values(array_filter([$owner, $parentId], static fn (?int $v): bool => $v !== null)),
        );
        $this->db->execute(
            'INSERT INTO ' . $t . ' (`owner_user_id`, `parent_id`, `name`, `sort_order`) VALUES (?, ?, ?, ?)',
            [$owner, $parentId, $name, $order],
        );

        return self::present((array) $this->find((int) $this->db->lastInsertId()));
    }

    /**
     * @param array{name?: string, parent_id?: ?int, sort_order?: int} $changes
     * @return array<string, mixed>
     */
    public function update(User $user, int $id, array $changes): array
    {
        $row = $this->requireEdit($user, $id);
        $owner = $row['owner_user_id'] === null ? null : (int) $row['owner_user_id'];
        $sets = [];
        $params = [];
        if (array_key_exists('parent_id', $changes)) {
            if ($changes['parent_id'] !== null) {
                $this->checkParent($owner, $id, $changes['parent_id']);
            }
            $sets[] = '`parent_id` = ?';
            $params[] = $changes['parent_id'];
        }
        if (isset($changes['name'])) {
            $sets[] = '`name` = ?';
            $params[] = $changes['name'];
        }
        if (isset($changes['sort_order'])) {
            $sets[] = '`sort_order` = ?';
            $params[] = $changes['sort_order'];
        }
        if ($sets !== []) {
            $params[] = $id;
            $this->db->execute('UPDATE ' . $this->db->t('asset_categories') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
        }

        return self::present((array) $this->find($id));
    }

    /**
     * Children move to the root (FK SET NULL); assets lose their category (FK SET NULL).
     */
    public function delete(User $user, int $id): void
    {
        $this->requireEdit($user, $id);
        $this->db->execute('DELETE FROM ' . $this->db->t('asset_categories') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Category allowed for an asset of $assetOwnerId (null = general): a general asset takes a
     * general category; a personal asset takes one of its owner's categories or a general one.
     *
     * @throws ValidationException category_id invalid
     */
    public function requireUsable(?int $categoryId, ?int $assetOwnerId): ?int
    {
        if ($categoryId === null) {
            return null;
        }
        $row = $this->find($categoryId);
        $owner = $row === null ? -1 : ($row['owner_user_id'] === null ? null : (int) $row['owner_user_id']);
        if ($row === null || ($owner !== null && $owner !== $assetOwnerId)) {
            throw new ValidationException('', ['category_id' => 'invalid']);
        }

        return $categoryId;
    }

    /**
     * Root category named $name for $ownerId (personal: own first, then general), created when missing.
     */
    public function findOrCreate(?int $ownerId, string $name): int
    {
        $t = $this->db->t('asset_categories');
        if ($ownerId !== null) {
            $id = $this->db->fetchValue('SELECT `id` FROM ' . $t . ' WHERE `owner_user_id` = ? AND `name` = ? ORDER BY `parent_id` IS NOT NULL, `id` LIMIT 1', [$ownerId, $name]);
            if ($id !== null) {
                return (int) $id;
            }
        }
        $id = $this->db->fetchValue('SELECT `id` FROM ' . $t . ' WHERE `owner_user_id` IS NULL AND `name` = ? ORDER BY `parent_id` IS NOT NULL, `id` LIMIT 1', [$name]);
        if ($id !== null) {
            return (int) $id;
        }
        $this->db->execute('INSERT INTO ' . $t . ' (`owner_user_id`, `parent_id`, `name`, `sort_order`) VALUES (?, NULL, ?, 0)', [$ownerId, $name]);

        return (int) $this->db->lastInsertId();
    }

    /**
     * @return array<string, mixed>
     */
    private function requireEdit(User $user, int $id): array
    {
        $row = $this->find($id);
        if ($row === null || ($row['owner_user_id'] !== null && (int) $row['owner_user_id'] !== $user->id)) {
            throw new NotFoundException();
        }
        if ($row['owner_user_id'] === null && !$user->isAdmin()) {
            throw new ForbiddenException();
        }

        return $row;
    }

    /**
     * Parent in the same scope, and no cycle (moving a category under its own descendant).
     */
    private function checkParent(?int $owner, ?int $selfId, int $parentId): void
    {
        $current = $parentId;
        for ($depth = 0; $current !== null; $depth++) {
            $row = $this->find($current);
            $rowOwner = $row === null ? -1 : ($row['owner_user_id'] === null ? null : (int) $row['owner_user_id']);
            if ($row === null || $rowOwner !== $owner || $current === $selfId || $depth >= self::MAX_DEPTH) {
                throw new ValidationException('', ['parent_id' => 'invalid']);
            }
            $current = $row['parent_id'] === null ? null : (int) $row['parent_id'];
        }
    }
}
