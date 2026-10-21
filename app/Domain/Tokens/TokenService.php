<?php

declare(strict_types=1);

namespace JDR\Domain\Tokens;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Assets\AssetPolicy;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Games\Game;
use JDR\Domain\Games\GameMemberRepository;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Users\User;

/**
 * Token definitions (contract P3): GM/co-GM read and write every token of the game; a player
 * reads only the tokens they own by default (others: 403); non-members get 404.
 * The image must be usable by the editor (own, general, or already used by the game) and the
 * default owner must belong to the game (GM included).
 */
final class TokenService
{
    public function __construct(
        private TokenRepository $tokens,
        private GamePolicy $games,
        private GameMemberRepository $members,
        private AssetRepository $assets,
        private AssetPolicy $assetPolicy,
    ) {
    }

    /**
     * @return array{0: Game, 1: list<Token>}
     */
    public function listFor(User $user, int $gameId): array
    {
        $game = $this->games->requireView($user, $gameId);

        return [$game, $this->tokens->listForGame($game->id, $game->isEditor() ? null : $user->id)];
    }

    /**
     * @throws NotFoundException|ForbiddenException
     */
    public function requireView(User $user, int $tokenId): Token
    {
        $token = $this->live($tokenId);
        $game = $this->games->requireView($user, $token->gameId);
        if (!$game->isEditor() && $token->defaultOwnerUserId !== $user->id) {
            throw new ForbiddenException();
        }

        return $token;
    }

    /**
     * @throws NotFoundException|ForbiddenException
     */
    public function requireEdit(User $user, int $tokenId): Token
    {
        return $this->editable($user, $tokenId)[0];
    }

    /**
     * @param array<array-key, mixed> $body
     */
    public function create(User $user, int $gameId, array $body): Token
    {
        $game = $this->games->requireEdit($user, $gameId);
        $values = TokenInput::create($body);
        $this->checkReferences($user, $game, $values, null);
        $id = $this->tokens->insert($game->id, $values);

        return $this->tokens->find($id) ?? throw new \RuntimeException('Token lost after insert.');
    }

    /**
     * @param array<array-key, mixed> $body
     */
    public function update(User $user, int $tokenId, array $body): Token
    {
        [$token, $game] = $this->editable($user, $tokenId);
        $changes = TokenInput::patch($body, $token);
        $this->checkReferences($user, $game, $changes, $token);
        if ($changes !== []) {
            $this->tokens->update($token->id, $changes);
        }

        return $this->tokens->find($token->id) ?? $token;
    }

    public function delete(User $user, int $tokenId): void
    {
        $token = $this->requireEdit($user, $tokenId);
        $this->tokens->softDelete($token->id);
    }

    /**
     * @return array{0: Token, 1: Game}
     */
    private function editable(User $user, int $tokenId): array
    {
        $token = $this->live($tokenId);

        return [$token, $this->games->requireEdit($user, $token->gameId)];
    }

    private function live(int $tokenId): Token
    {
        $token = $this->tokens->find($tokenId);
        if ($token === null || $token->deletedAt !== null) {
            throw new NotFoundException();
        }

        return $token;
    }

    /**
     * @param array<string, mixed> $values
     * @throws ValidationException asset_id / default_owner_user_id not_found
     */
    private function checkReferences(User $user, Game $game, array $values, ?Token $current): void
    {
        $errors = [];
        $assetId = $values['asset_id'] ?? null;
        if (is_int($assetId) && $assetId !== $current?->assetId) {
            $asset = $this->assets->find($assetId);
            if ($asset === null || !$this->assetPolicy->canUseInGame($user, $asset, $game->id)) {
                $errors['asset_id'] = 'not_found';
            }
        }
        $ownerId = $values['default_owner_user_id'] ?? null;
        if (is_int($ownerId) && $ownerId !== $current?->defaultOwnerUserId
            && $ownerId !== $game->gmUserId && $this->members->find($game->id, $ownerId) === null) {
            $errors['default_owner_user_id'] = 'not_found';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
    }
}
