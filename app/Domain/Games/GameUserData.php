<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Encounters\EncounterRepository;
use JDR\Domain\Support\Dates;
use JDR\Domain\Tokens\TokenPresenter;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserDataExtension;

/**
 * Games in the personal data export and on account deletion (projet.md 11.1):
 * each live game run by the user goes to its oldest co-GM (audit "game.transfer"), or else to the
 * trash (audit "game.trash", purged after trash_days); the user's memberships are removed and
 * they no longer own any token. Audit rows carry ids only (no game content: privacy, 11.2).
 */
final class GameUserData implements UserDataExtension
{
    public function __construct(
        private GameRepository $games,
        private GameMemberRepository $members,
        private TokenRepository $tokens,
        private EncounterRepository $encounters,
        private AuditLog $audit,
    ) {
    }

    public function name(): string
    {
        return 'games';
    }

    public function export(User $user): mixed
    {
        $run = [];
        foreach ($this->games->idsRunBy($user->id, true) as $gameId) {
            $game = $this->games->find($gameId, $user->id);
            if ($game === null) {
                continue;
            }
            $run[] = [
                'id' => $game->id,
                'name' => $game->name,
                'description' => $game->description,
                'settings' => $game->settings,
                'archived_at' => Dates::iso($game->archivedAt),
                'deleted_at' => Dates::iso($game->deletedAt),
                'created_at' => Dates::iso($game->createdAt),
                'members' => array_map(static fn (array $m): array => [
                    'user_id' => $m['user_id'],
                    'username' => $m['username'],
                    'role' => $m['role'],
                    'joined_at' => Dates::iso($m['joined_at']),
                ], $this->members->list($game->id)),
                'tokens' => array_map(
                    static fn ($t): array => TokenPresenter::export($t),
                    $this->tokens->listForGame($game->id),
                ),
                'encounters' => array_map(static function ($e): array {
                    $data = $e->toApi();
                    unset($data['game_id']);

                    return $data;
                }, $this->encounters->listForGame($game->id)),
            ];
        }

        return [
            'run' => $run,
            'memberships' => array_map(static fn (array $m): array => [
                'game_id' => $m['game_id'],
                'name' => $m['name'],
                'role' => $m['role'],
                'joined_at' => Dates::iso($m['joined_at']),
            ], $this->members->membershipsOf($user->id)),
        ];
    }

    public function deleteUserData(User $user): void
    {
        foreach ($this->games->idsRunBy($user->id) as $gameId) {
            $heir = $this->members->oldestCoGm($gameId);
            if ($heir !== null && $heir !== $user->id) {
                $this->members->remove($gameId, $heir);
                $this->games->setGm($gameId, $heir);
                $this->audit->record(null, 'game.transfer', 'game', $gameId, ['to_user_id' => $heir]);
            } else {
                $this->games->softDelete($gameId);
                $this->audit->record(null, 'game.trash', 'game', $gameId);
            }
        }
        $this->members->removeUser($user->id);
        $this->tokens->clearOwnerEverywhere($user->id);
    }
}
