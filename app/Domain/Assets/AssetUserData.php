<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Support\Dates;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserDataExtension;

/**
 * Personal assets in the data export (metadata only) and on account deletion (projet.md 11.1:
 * personal assets deleted — soft delete here, files removed by the trash purge).
 */
final class AssetUserData implements UserDataExtension
{
    public function __construct(private Db $db, private AssetRepository $assets)
    {
    }

    public function name(): string
    {
        return 'assets';
    }

    public function export(User $user): mixed
    {
        return array_map(static fn (Asset $a): array => [
            'id' => $a->id,
            'uuid' => $a->uuid,
            'name' => $a->name,
            'kind' => $a->kind,
            'mime' => $a->mime,
            'width' => $a->width,
            'height' => $a->height,
            'size_bytes' => $a->sizeBytes,
            'sha256' => $a->sha256,
            'created_at' => Dates::iso($a->createdAt),
        ], $this->assets->liveOfOwner($user->id));
    }

    public function deleteUserData(User $user): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $this->db->execute(
            'UPDATE ' . $this->db->t('assets') . ' SET `deleted_at` = ?, `updated_at` = ? WHERE `owner_user_id` = ? AND `deleted_at` IS NULL',
            [$now, $now, $user->id],
        );
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_used_bytes` = 0 WHERE `id` = ?', [$user->id]);
    }
}
