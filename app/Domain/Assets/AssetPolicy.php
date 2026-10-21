<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Domain\Users\User;

/**
 * Rights on assets (projet.md 11.2): everyone sees the general library, only admins change it;
 * a personal asset is seen and changed by its owner only (admins included: no access to the
 * personal assets of others). Another user's personal asset is reported as not found.
 * P3 adds: members of a game using the asset.
 */
final class AssetPolicy
{
    public function canView(User $user, Asset $asset): bool
    {
        return $asset->ownerId === null || $asset->ownerId === $user->id;
    }

    public function canEdit(User $user, Asset $asset): bool
    {
        return $asset->ownerId === null ? $user->isAdmin() : $asset->ownerId === $user->id;
    }

    /**
     * @throws NotFoundException
     */
    public function requireView(User $user, ?Asset $asset): Asset
    {
        if ($asset === null || $asset->deletedAt !== null || !$this->canView($user, $asset)) {
            throw new NotFoundException();
        }

        return $asset;
    }

    /**
     * @throws NotFoundException|ForbiddenException
     */
    public function requireEdit(User $user, ?Asset $asset): Asset
    {
        $asset = $this->requireView($user, $asset);
        if (!$this->canEdit($user, $asset)) {
            throw new ForbiddenException();
        }

        return $asset;
    }

    /**
     * Owner of a new item in $scope ("personal" | "general"): general requires an admin.
     *
     * @throws ForbiddenException
     */
    public function ownerFor(User $user, string $scope): ?int
    {
        if ($scope === Asset::SCOPE_GENERAL) {
            if (!$user->isAdmin()) {
                throw new ForbiddenException();
            }

            return null;
        }

        return $user->id;
    }
}
