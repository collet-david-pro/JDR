<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Assets\AssetPolicy;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;
use JDR\Domain\Users\UserRepository;

/**
 * Games and their members (contract P3). Rights: GamePolicy (view = member, manage = GM).
 */
final class GameService
{
    public function __construct(
        private Db $db,
        private GameRepository $games,
        private GameMemberRepository $members,
        private GamePolicy $policy,
        private UserRepository $users,
        private TokenRepository $tokens,
        private AssetRepository $assets,
        private AssetPolicy $assetPolicy,
    ) {
    }

    /**
     * @param array<string, mixed> $query
     * @return list<Game>
     * @throws ValidationException role / state invalid
     */
    public function list(User $user, array $query): array
    {
        $errors = [];
        $role = $query['role'] ?? null;
        $state = $query['state'] ?? 'active';
        if ($role === '') {
            $role = null;
        }
        if ($state === '') {
            $state = 'active';
        }
        if ($role !== null && !in_array($role, GameRepository::ROLES, true)) {
            $errors['role'] = 'invalid';
        }
        if (!in_array($state, GameRepository::STATES, true)) {
            $errors['state'] = 'invalid';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        /** @var ?string $role */
        /** @var string $state */
        return $this->games->listFor($user->id, $role, $state);
    }

    /**
     * The creator becomes the GM (games.gm_user_id, no game_members row).
     *
     * @param array<array-key, mixed> $body
     */
    public function create(User $user, array $body): Game
    {
        $values = GameInput::create($body);
        $id = (int) $this->db->transaction(fn (): int => $this->games->insert(
            $user->id,
            $values['name'],
            $values['description'],
            GameSettings::toJson($values['settings']),
        ));

        return $this->reload($id, $user);
    }

    /**
     * @param array<array-key, mixed> $body
     */
    public function update(User $user, int $gameId, array $body): Game
    {
        $game = $this->policy->requireManage($user, $gameId);
        $changes = GameInput::patch($body, $game);
        $cover = $changes['cover_asset_id'] ?? null;
        if ($cover !== null && $cover !== $game->coverAssetId) {
            $asset = $this->assets->find($cover);
            if ($asset === null || !$this->assetPolicy->canUseInGame($user, $asset, $game->id)) {
                throw new ValidationException('', ['cover_asset_id' => 'not_found']);
            }
        }
        if (isset($changes['settings'])) {
            $changes['settings'] = GameSettings::toJson($changes['settings']);
        }
        $this->games->update($game->id, $changes);

        return $this->reload($game->id, $user);
    }

    /**
     * Soft delete (trash for trash_days); idempotent on a game already in the trash.
     */
    public function delete(User $user, int $gameId): void
    {
        $game = $this->policy->requireManage($user, $gameId, true);
        $this->games->softDelete($game->id);
    }

    public function archive(User $user, int $gameId): Game
    {
        $game = $this->policy->requireManage($user, $gameId);
        if ($game->archivedAt === null) {
            $this->games->setArchived($game->id, true);
        }

        return $this->reload($game->id, $user);
    }

    /**
     * Out of the archives and out of the trash.
     */
    public function restore(User $user, int $gameId): Game
    {
        $game = $this->policy->requireManage($user, $gameId, true);
        $this->games->restore($game->id);

        return $this->reload($game->id, $user);
    }

    /**
     * @return array{0: Game, 1: list<array{user_id: int, username: string, role: string, joined_at: string}>}
     */
    public function members(User $user, int $gameId): array
    {
        $game = $this->policy->requireView($user, $gameId);

        return [$game, $this->members->list($game->id)];
    }

    /**
     * Direct invitation (projet.md 2.2) by e-mail or username. Unknown, suspended or deleted
     * accounts all give the same answer (422 identifier: not_found).
     *
     * @param array<array-key, mixed> $body
     * @return array{user_id: int, username: string, role: string, joined_at: string}
     */
    public function addMember(User $user, int $gameId, array $body): array
    {
        $game = $this->policy->requireManage($user, $gameId);
        $errors = [];
        $identifier = Fields::text($body['identifier'] ?? null, 191);
        if ($identifier === null || $identifier === '') {
            $errors['identifier'] = ($body['identifier'] ?? null) === null || $identifier === '' ? 'required' : 'invalid';
        }
        $role = self::role($body, false, $errors);
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $target = $this->users->findByIdentifier((string) $identifier);
        if ($target === null || !$target->isActive()) {
            throw new ValidationException('', ['identifier' => 'not_found']);
        }
        if ($target->id === $game->gmUserId || $this->members->find($game->id, $target->id) !== null) {
            throw new ValidationException('', ['identifier' => 'already_member']);
        }
        $this->members->add($game->id, $target->id, $role ?? Game::ROLE_PLAYER);

        return $this->members->find($game->id, $target->id) ?? throw new \RuntimeException('Member lost after insert.');
    }

    /**
     * @param array<array-key, mixed> $body
     * @return array{user_id: int, username: string, role: string, joined_at: string}
     */
    public function setMemberRole(User $user, int $gameId, int $userId, array $body): array
    {
        $game = $this->policy->requireManage($user, $gameId);
        if ($userId === $game->gmUserId) {
            throw new ForbiddenException();
        }
        $member = $this->members->find($game->id, $userId) ?? throw new NotFoundException();
        $errors = [];
        $role = self::role($body, true, $errors);
        if ($errors !== [] || $role === null) {
            throw new ValidationException('', $errors === [] ? ['role' => 'required'] : $errors);
        }
        if ($role !== $member['role']) {
            $this->members->setRole($game->id, $userId, $role);
        }

        return $this->members->find($game->id, $userId) ?? $member;
    }

    /**
     * The GM removes a member, or a member leaves the game; the GM never leaves (403).
     * The tokens owned by default by the member lose their owner.
     */
    public function removeMember(User $user, int $gameId, int $userId): void
    {
        $game = $this->policy->requireView($user, $gameId);
        if ($userId === $game->gmUserId || ($userId !== $user->id && !$this->policy->canManage($user, $game))) {
            throw new ForbiddenException();
        }
        if ($this->members->find($game->id, $userId) === null) {
            throw new NotFoundException();
        }
        $this->db->transaction(function () use ($game, $userId): void {
            $this->members->remove($game->id, $userId);
            $this->tokens->clearOwner($game->id, $userId);
        });
    }

    private function reload(int $gameId, User $user): Game
    {
        return $this->games->find($gameId, $user->id) ?? throw new NotFoundException();
    }

    /**
     * @param array<array-key, mixed> $body
     * @param array<string, string>   $errors
     */
    private static function role(array $body, bool $required, array &$errors): ?string
    {
        $role = $body['role'] ?? null;
        if ($role === null) {
            if ($required) {
                $errors['role'] = 'required';
            }

            return null;
        }
        if (!is_string($role) || !in_array($role, Game::MEMBER_ROLES, true)) {
            $errors['role'] = 'invalid';

            return null;
        }

        return $role;
    }
}
