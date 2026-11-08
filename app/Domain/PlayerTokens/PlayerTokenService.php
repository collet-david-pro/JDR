<?php

declare(strict_types=1);

namespace JDR\Domain\PlayerTokens;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\AssetImporter;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Assets\StorageQuota;
use JDR\Domain\Assets\UploadedFile;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Tokens\Token;
use JDR\Domain\Tokens\TokenInput;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;

/**
 * The personal token collection (at most MAX_PER_ACCOUNT per account) and the token a member
 * picks for a game. Rendered PNG and source portrait are ordinary assets of the account
 * (source "player_token" / "player_token_src": hidden from the library, quota counted, signed URLs).
 * Rights: every collection read / write is scoped to its owner (another account gets 404); a choice
 * needs a game the user can see (non-members get 404) and a token of their own collection.
 */
final class PlayerTokenService
{
    public const MAX_PER_ACCOUNT = 100;
    public const NAME_MAX = 80;
    public const DESIGN_MAX_BYTES = 6000;
    public const SOURCE = 'player_token';
    public const SOURCE_PORTRAIT = 'player_token_src';
    private const SIDE_MIN = 64;
    private const SIDE_MAX = 1024;

    public function __construct(
        private Db $db,
        private PlayerTokenRepository $repo,
        private AssetImporter $importer,
        private AssetRepository $assets,
        private AssetStorage $storage,
        private AssetLimits $limits,
        private StorageQuota $quota,
        private GamePolicy $games,
        private TokenRepository $tokens,
    ) {
    }

    /**
     * @return list<array<string, mixed>> rows with asset_uuid, source_uuid, games_count
     */
    public function list(User $user): array
    {
        return $this->repo->listOf($user->id);
    }

    /**
     * @return array<string, mixed>
     */
    public function get(User $user, int $id): array
    {
        return $this->repo->findOf($user->id, $id) ?? throw new NotFoundException();
    }

    /**
     * @param array<string, mixed> $fields name, design (JSON text)
     * @return array<string, mixed>
     * @throws ConflictException 409 player_token_limit
     */
    public function create(User $user, array $fields, ?UploadedFile $image, ?UploadedFile $source): array
    {
        $name = self::name($fields['name'] ?? null);
        $design = self::design($fields['design'] ?? null);
        if ($image === null) {
            throw new ValidationException('', ['file' => 'required']);
        }
        $this->requireRoom($user);
        $assetId = $this->importImage($user, $image, $name, self::SOURCE, true);
        $sourceId = null;
        try {
            $sourceId = $source === null ? null : $this->importImage($user, $source, $name, self::SOURCE_PORTRAIT, false);
            $id = $this->repo->insert($user->id, $name, $assetId, $sourceId, $design);
        } catch (\Throwable $e) {
            $this->releaseIfOrphan([$assetId, $sourceId]);
            throw $e;
        }

        return $this->get($user, $id);
    }

    /**
     * Rename and / or re-edit: a new rendered image (and its design) replaces the old one.
     *
     * @param array<string, mixed> $fields name?, design? (with a new image)
     * @return array<string, mixed>
     */
    public function update(User $user, int $id, array $fields, ?UploadedFile $image, ?UploadedFile $source): array
    {
        $row = $this->get($user, $id);
        $changes = [];
        if (array_key_exists('name', $fields)) {
            $changes['name'] = self::name($fields['name']);
        }
        $old = [];
        if ($image !== null) {
            $changes['design'] = self::design($fields['design'] ?? null);
            $changes['asset_id'] = $this->importImage($user, $image, (string) ($changes['name'] ?? $row['name']), self::SOURCE, true);
            $old[] = $row['asset_id'] === null ? null : (int) $row['asset_id'];
            if ($source !== null) {
                $changes['source_asset_id'] = $this->importImage($user, $source, (string) ($changes['name'] ?? $row['name']), self::SOURCE_PORTRAIT, false);
                $old[] = $row['source_asset_id'] === null ? null : (int) $row['source_asset_id'];
            } elseif (($fields['keep_source'] ?? null) !== '1' && ($fields['keep_source'] ?? null) !== true) {
                $changes['source_asset_id'] = null; // the new design no longer uses a portrait
                $old[] = $row['source_asset_id'] === null ? null : (int) $row['source_asset_id'];
            }
        }
        if ($changes !== []) {
            $this->repo->update($id, $changes);
        }
        $this->releaseIfOrphan($old);

        return $this->get($user, $id);
    }

    /**
     * The copy shares the images of the original (released when no token references them).
     *
     * @return array<string, mixed>
     */
    public function duplicate(User $user, int $id, ?string $name): array
    {
        $row = $this->get($user, $id);
        $this->requireRoom($user);
        $copy = self::name($name ?? $row['name']);
        $newId = $this->repo->insert(
            $user->id,
            $copy,
            $row['asset_id'] === null ? null : (int) $row['asset_id'],
            $row['source_asset_id'] === null ? null : (int) $row['source_asset_id'],
            (string) $row['design'],
        );

        return $this->get($user, $newId);
    }

    /**
     * Deletes the token; games using it fall back on the GM's image. Refused (409
     * player_token_in_use, with the number of games) unless $force.
     *
     * @throws ConflictException
     */
    public function delete(User $user, int $id, bool $force): void
    {
        $row = $this->get($user, $id);
        $games = $this->repo->gamesUsing($id);
        if ($games !== [] && !$force) {
            throw new ConflictException('', ['games' => (string) count($games)], 'player_token_in_use');
        }
        $this->db->transaction(function () use ($id): void {
            $this->repo->delete($id);
        });
        $this->releaseIfOrphan([
            $row['asset_id'] === null ? null : (int) $row['asset_id'],
            $row['source_asset_id'] === null ? null : (int) $row['source_asset_id'],
        ]);
    }

    /**
     * The token chosen for a game, or null.
     *
     * @return array<string, mixed>|null
     */
    public function choice(User $user, int $gameId): ?array
    {
        $game = $this->games->requireView($user, $gameId);
        $id = $this->repo->choiceOf($game->id, $user->id);

        return $id === null ? null : $this->repo->findOf($user->id, $id);
    }

    /**
     * Picks (or clears, null) the member's token for a game. Out of session only, unless $initial
     * (the first choice made while joining). The game gets a token definition for the member when
     * it has none (name = their name, medium size) so that the GM can place it.
     *
     * @throws ConflictException 409 session_in_progress
     */
    public function choose(User $user, int $gameId, ?int $playerTokenId, bool $initial = false): ?Token
    {
        $game = $this->games->requireView($user, $gameId);
        if (!$initial && $this->repo->sessionInProgress($game->id)) {
            throw new ConflictException('', [], 'session_in_progress');
        }
        if ($playerTokenId !== null && $this->repo->findOf($user->id, $playerTokenId) === null) {
            throw new ValidationException('', ['player_token_id' => 'not_found']);
        }

        return $this->db->transaction(function () use ($game, $user, $playerTokenId): ?Token {
            $this->repo->setChoice($game->id, $user->id, $playerTokenId);
            if ($playerTokenId === null) {
                return $this->tokens->findOwnedBy($game->id, $user->id);
            }
            $token = $this->tokens->findOwnedBy($game->id, $user->id);
            if ($token === null) {
                $values = TokenInput::create(['name' => mb_substr($user->username, 0, TokenInput::NAME_MAX), 'kind' => 'pc', 'default_owner_user_id' => $user->id]);
                $id = $this->tokens->insert($game->id, $values);
                $token = $this->tokens->find($id);
            }

            return $token;
        });
    }

    /**
     * Choice made while joining: only when the member has none yet (a later change is refused in session).
     */
    public function chooseWhenJoining(User $user, int $gameId, int $playerTokenId): void
    {
        if ($this->repo->choiceOf($gameId, $user->id) === null) {
            $this->choose($user, $gameId, $playerTokenId, true);
        }
    }

    /**
     * A member leaves a game: their choice is forgotten.
     */
    public function forget(int $gameId, int $userId): void
    {
        $this->repo->clearChoice($gameId, $userId);
    }

    /**
     * @throws ConflictException
     */
    private function requireRoom(User $user): void
    {
        if ($this->repo->countOf($user->id) >= self::MAX_PER_ACCOUNT) {
            throw new ConflictException('', ['max' => (string) self::MAX_PER_ACCOUNT], 'player_token_limit');
        }
    }

    /**
     * Imports an uploaded PNG / JPEG as an asset of the account; the image must be square.
     *
     * @return int asset id
     */
    private function importImage(User $user, UploadedFile $file, string $name, string $source, bool $square): int
    {
        if ($file->error === UPLOAD_ERR_NO_FILE) {
            throw new ValidationException('', ['file' => 'required']);
        }
        if ($file->error !== UPLOAD_ERR_OK || $file->size > $this->limits->maxUploadBytes()) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $tmp = $this->storage->newTmpPath();
        if (!$file->moveTo($tmp)) {
            throw new \RuntimeException('Cannot move the uploaded file to storage/tmp.');
        }
        $result = $this->importer->import($tmp, new ImportRequest($user->id, $name, 'token', null, [], $source));
        $asset = $result->asset;
        $bad = $asset->isAnimated || $asset->width < self::SIDE_MIN || $asset->width > self::SIDE_MAX
            || ($square && $asset->width !== $asset->height);
        if ($bad) {
            if (!$result->duplicate) {
                $this->releaseIfOrphan([$asset->id]);
            }
            throw new ValidationException('', ['file' => 'invalid']);
        }

        return $asset->id;
    }

    /**
     * Soft-deletes (quota given back) the generated assets no token of the collection uses any more.
     *
     * @param list<int|null> $assetIds
     */
    private function releaseIfOrphan(array $assetIds): void
    {
        foreach (array_unique(array_filter($assetIds, static fn ($v): bool => $v !== null)) as $assetId) {
            $asset = $this->assets->find($assetId);
            if ($asset === null || $asset->deletedAt !== null || !in_array($asset->source, [self::SOURCE, self::SOURCE_PORTRAIT], true)
                || $this->repo->assetReferenced($assetId)) {
                continue;
            }
            $this->db->transaction(function () use ($asset): void {
                if ($this->assets->softDelete($asset->id) && $asset->ownerId !== null) {
                    $this->quota->release($asset->ownerId, $asset->storedBytes());
                }
            });
        }
    }

    /**
     * @throws ValidationException
     */
    private static function name(mixed $value): string
    {
        $name = is_string($value) ? trim($value) : '';
        if ($name === '') {
            throw new ValidationException('', ['name' => 'required']);
        }
        if (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
            throw new ValidationException('', ['name' => 'too_long']);
        }

        return $name;
    }

    /**
     * The design is opaque to the server: a JSON object of bounded size, re-encoded.
     *
     * @throws ValidationException
     */
    private static function design(mixed $value): string
    {
        if (!is_string($value) || strlen($value) > self::DESIGN_MAX_BYTES) {
            throw new ValidationException('', ['design' => 'invalid']);
        }
        $data = json_decode($value, true);
        if (!is_array($data) || array_is_list($data) && $data !== []) {
            throw new ValidationException('', ['design' => 'invalid']);
        }

        return json_encode((object) $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
