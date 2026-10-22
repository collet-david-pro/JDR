<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\Dates;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserDataExtension;

/**
 * Maps in the personal data export and on account deletion (projet.md 11.1). Runs after
 * GameUserData (games transferred to a co-GM or trashed): the maps the user created in games now
 * run by someone else go to that GM; maps of the games sent to the trash leave with them
 * (purge, FK CASCADE).
 */
final class MapUserData implements UserDataExtension
{
    public function __construct(private MapRepository $maps)
    {
    }

    public function name(): string
    {
        return 'maps';
    }

    public function export(User $user): mixed
    {
        return array_map(static fn (array $m): array => [
            'id' => $m['id'],
            'game_id' => $m['game_id'],
            'name' => $m['name'],
            'created_at' => Dates::iso($m['created_at']),
        ], $this->maps->ownedBy($user->id));
    }

    public function deleteUserData(User $user): void
    {
        $this->maps->reassignToGameGm($user->id);
    }
}
