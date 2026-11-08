<?php

declare(strict_types=1);

namespace JDR\Domain\Tokens;

defined('JDR_BOOT') || exit;

/**
 * Token definition (row of tokens + uuid of its effective image: the player's chosen token, unless the GM forces their own). Every distance is in cells.
 */
final class Token
{
    public const KINDS = ['pc', 'npc', 'monster', 'object'];

    /**
     * @param array{enabled: bool, range: int|float, dark: int|float} $vision
     * @param array{radius: int|float, dim_radius: int|float, color: string, intensity: int|float, flicker: bool}|null $light
     */
    public function __construct(
        public readonly int $id,
        public readonly int $gameId,
        public readonly string $name,
        public readonly ?int $assetId,
        public readonly ?string $assetUuid,
        public readonly string $kind,
        public readonly float $sizeW,
        public readonly float $sizeH,
        public readonly ?int $defaultOwnerUserId,
        public readonly array $vision,
        public readonly ?array $light,
        public readonly ?string $ringColor,
        public readonly string $createdAt,
        public readonly string $updatedAt,
        public readonly ?string $deletedAt,
        public readonly bool $gmImageForced = false,
        public readonly ?string $ownAssetUuid = null,
        public readonly ?int $playerTokenId = null,
        public readonly ?string $playerTokenName = null,
        public readonly ?string $playerAssetUuid = null,
    ) {
    }

    /**
     * @param array<string, mixed> $row columns of tokens + asset_uuid, asset_deleted_at
     */
    public static function fromRow(array $row): self
    {
        $vision = json_decode((string) $row['vision'], true);
        $light = $row['light'] === null ? null : json_decode((string) $row['light'], true);
        $assetLive = $row['asset_id'] !== null && ($row['asset_uuid'] ?? null) !== null
            && ($row['asset_deleted_at'] ?? null) === null;
        $own = $assetLive ? (string) $row['asset_uuid'] : null;
        $playerLive = ($row['player_asset_uuid'] ?? null) !== null && ($row['player_asset_deleted_at'] ?? null) === null;
        $player = $playerLive ? (string) $row['player_asset_uuid'] : null;
        $forced = (int) ($row['gm_image_forced'] ?? 0) === 1;
        // The effective image: the player's choice wins unless the GM imposed their own image.
        $effective = !$forced && $player !== null ? $player : $own;

        return new self(
            (int) $row['id'],
            (int) $row['game_id'],
            (string) $row['name'],
            $row['asset_id'] === null ? null : (int) $row['asset_id'],
            $effective,
            (string) $row['kind'],
            (float) $row['size_w'],
            (float) $row['size_h'],
            $row['default_owner_user_id'] === null ? null : (int) $row['default_owner_user_id'],
            TokenInput::vision(is_array($vision) ? $vision : [], TokenInput::VISION_DEFAULTS) ?? TokenInput::VISION_DEFAULTS,
            is_array($light) ? (TokenInput::light($light, TokenInput::LIGHT_DEFAULTS) ?? TokenInput::LIGHT_DEFAULTS) : null,
            $row['ring_color'] === null ? null : (string) $row['ring_color'],
            (string) $row['created_at'],
            (string) $row['updated_at'],
            $row['deleted_at'] === null ? null : (string) $row['deleted_at'],
            $forced,
            $own,
            ($row['player_token_id'] ?? null) === null ? null : (int) $row['player_token_id'],
            ($row['player_token_name'] ?? null) === null ? null : (string) $row['player_token_name'],
            $player,
        );
    }
}
