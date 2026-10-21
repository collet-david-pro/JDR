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
 * Asset tags: personal (owner = user) or general (owner NULL, admins). Tag {id, name, scope}.
 * The unique key (owner_user_id, name) does not apply to NULL owners in MySQL: uniqueness of
 * general tags is enforced here (case-insensitive, utf8mb4_unicode_ci).
 */
final class TagService
{
    public const MAX_TAGS_PER_ASSET = 20;
    public const MAX_LENGTH = 50;

    public function __construct(private Db $db, private AssetPolicy $policy)
    {
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function list(User $user): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . $this->db->t('asset_tags') . ' WHERE `owner_user_id` IS NULL OR `owner_user_id` = ? '
            . 'ORDER BY (`owner_user_id` IS NULL) DESC, `name`, `id`',
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
            'scope' => $row['owner_user_id'] === null ? Asset::SCOPE_GENERAL : Asset::SCOPE_PERSONAL,
        ];
    }

    /**
     * Trimmed, inner spaces collapsed; null when invalid.
     */
    public static function normalize(mixed $name, int $max = self::MAX_LENGTH): ?string
    {
        if (!is_string($name) || preg_match('//u', $name) !== 1 || preg_match('/[\x00-\x1F\x7F]/', $name) === 1) {
            return null;
        }
        $name = trim((string) preg_replace('/\s+/u', ' ', $name));
        $length = mb_strlen($name, 'UTF-8');

        return $length >= 1 && $length <= $max ? $name : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function create(User $user, string $name, string $scope): array
    {
        $owner = $this->policy->ownerFor($user, $scope);
        if ($this->findId($owner, $name) !== null) {
            throw new ValidationException('', ['name' => 'taken']);
        }
        $id = $this->insert($owner, $name);

        return self::present((array) $this->db->fetchOne('SELECT * FROM ' . $this->db->t('asset_tags') . ' WHERE `id` = ?', [$id]));
    }

    public function delete(User $user, int $id): void
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('asset_tags') . ' WHERE `id` = ?', [$id]);
        if ($row === null || ($row['owner_user_id'] !== null && (int) $row['owner_user_id'] !== $user->id)) {
            throw new NotFoundException();
        }
        if ($row['owner_user_id'] === null && !$user->isAdmin()) {
            throw new ForbiddenException();
        }
        $this->db->execute('DELETE FROM ' . $this->db->t('asset_tags') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Tag ids for these names in the scope of $ownerId (null = general), created when missing.
     *
     * @param list<string> $names normalized names
     * @return list<int>
     */
    public function resolve(?int $ownerId, array $names): array
    {
        $ids = [];
        foreach ($names as $name) {
            $id = $this->findId($ownerId, $name) ?? $this->insert($ownerId, $name);
            $ids[$id] = $id;
        }

        return array_values($ids);
    }

    /**
     * Ids of the tags visible to $userId (own + general) matching an id or a name.
     *
     * @return list<int>
     */
    public function visibleIds(int $userId, string $idOrName): array
    {
        $t = $this->db->t('asset_tags');
        $rows = ctype_digit($idOrName)
            ? $this->db->fetchAll('SELECT `id` FROM ' . $t . ' WHERE `id` = ? AND (`owner_user_id` IS NULL OR `owner_user_id` = ?)', [(int) $idOrName, $userId])
            : $this->db->fetchAll('SELECT `id` FROM ' . $t . ' WHERE `name` = ? AND (`owner_user_id` IS NULL OR `owner_user_id` = ?)', [$idOrName, $userId]);

        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }

    private function findId(?int $ownerId, string $name): ?int
    {
        $id = $this->db->fetchValue(
            'SELECT `id` FROM ' . $this->db->t('asset_tags') . ' WHERE '
            . ($ownerId === null ? '`owner_user_id` IS NULL' : '`owner_user_id` = ?') . ' AND `name` = ? ORDER BY `id` LIMIT 1',
            $ownerId === null ? [$name] : [$ownerId, $name],
        );

        return $id === null ? null : (int) $id;
    }

    private function insert(?int $ownerId, string $name): int
    {
        if ($ownerId === null) {
            // General tags: serialize creations so that two admins cannot create the same name.
            $lock = substr('jdr_tag:' . $this->db->prefix() . ':' . md5(mb_strtolower($name, 'UTF-8')), 0, 64);
            $this->db->fetchValue('SELECT GET_LOCK(?, 5)', [$lock]);
            try {
                $existing = $this->findId(null, $name);
                if ($existing !== null) {
                    return $existing;
                }
                $this->db->execute('INSERT INTO ' . $this->db->t('asset_tags') . ' (`owner_user_id`, `name`) VALUES (NULL, ?)', [$name]);

                return (int) $this->db->lastInsertId();
            } finally {
                $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
            }
        }
        $this->db->execute('INSERT IGNORE INTO ' . $this->db->t('asset_tags') . ' (`owner_user_id`, `name`) VALUES (?, ?)', [$ownerId, $name]);
        $id = (int) $this->db->lastInsertId();

        return $id > 0 ? $id : (int) $this->findId($ownerId, $name);
    }
}
