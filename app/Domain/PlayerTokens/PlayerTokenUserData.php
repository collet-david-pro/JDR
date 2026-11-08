<?php

declare(strict_types=1);

namespace JDR\Domain\PlayerTokens;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\Dates;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserDataExtension;

/**
 * Token collection in the data export (names and designs) and its removal on account deletion
 * (the images are personal assets, handled by AssetUserData).
 */
final class PlayerTokenUserData implements UserDataExtension
{
    public function __construct(private PlayerTokenRepository $repo)
    {
    }

    /**
     * Returns the section name used in the data export.
     */
    public function name(): string
    {
        return 'player_tokens';
    }

    /**
     * Returns the user's token collection for the personal data export.
     */
    public function export(User $user): mixed
    {
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'name' => (string) $r['name'],
            'design' => json_decode((string) $r['design'], true),
            'created_at' => Dates::iso((string) $r['created_at']),
        ], $this->repo->listOf($user->id));
    }

    /**
     * Deletes the collection and the game choices that follow (account deletion).
     */
    public function deleteUserData(User $user): void
    {
        $this->repo->deleteAllOf($user->id);
    }
}
