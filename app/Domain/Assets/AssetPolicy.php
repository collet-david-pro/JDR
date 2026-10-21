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
 * P3 (contract D8): the personal asset of another user is also visible through a live game
 * (AssetRepository::visibleThroughGames(): GM/co-GM see every asset of the game, a player only
 * the cover and the images of the tokens they own by default). Seeing never allows changing.
 */
final class AssetPolicy
{
    public function __construct(private AssetRepository $assets)
    {
    }

    public function canView(User $user, Asset $asset): bool
    {
        return $asset->ownerId === null || $asset->ownerId === $user->id
            || $this->assets->visibleThroughGames($asset->id, $user->id);
    }

    /**
     * May an editor (GM / co-GM) of $gameId put this asset on the game (token image, cover):
     * own or general asset, or an asset the game already uses.
     */
    public function canUseInGame(User $user, Asset $asset, int $gameId): bool
    {
        if ($asset->deletedAt !== null) {
            return false;
        }

        return $asset->ownerId === null || $asset->ownerId === $user->id
            || in_array($asset->id, $this->assets->gameAssetIds($gameId, null), true);
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
