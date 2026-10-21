<?php

declare(strict_types=1);

namespace JDR\Domain\Tokens;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Support\Dates;

/**
 * API representation "Token" (contract P3). Only call for tokens the viewer may see: the signed
 * image URLs follow the same rule (D8: a player only gets the images of their own tokens).
 */
final class TokenPresenter
{
    public function __construct(private AssetUrls $urls)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function one(Token $token, string $apiBase): array
    {
        return [
            'id' => $token->id,
            'game_id' => $token->gameId,
            'name' => $token->name,
            'asset_id' => $token->assetId,
            'image' => $token->assetUuid === null ? null : $this->urls->pair($apiBase, $token->assetUuid),
            'kind' => $token->kind,
            'size_w' => self::number($token->sizeW),
            'size_h' => self::number($token->sizeH),
            'default_owner_user_id' => $token->defaultOwnerUserId,
            'vision' => $token->vision,
            'light' => $token->light,
            'ring_color' => $token->ringColor,
            'created_at' => Dates::iso($token->createdAt),
            'updated_at' => Dates::iso($token->updatedAt),
        ];
    }

    /**
     * @param list<Token> $tokens
     * @return list<array<string, mixed>>
     */
    public function many(array $tokens, string $apiBase): array
    {
        return array_map(fn (Token $t): array => $this->one($t, $apiBase), $tokens);
    }

    /**
     * Personal data export (no URL).
     *
     * @return array<string, mixed>
     */
    public static function export(Token $token): array
    {
        return [
            'id' => $token->id,
            'name' => $token->name,
            'asset_id' => $token->assetId,
            'kind' => $token->kind,
            'size_w' => self::number($token->sizeW),
            'size_h' => self::number($token->sizeH),
            'vision' => $token->vision,
            'light' => $token->light,
            'ring_color' => $token->ringColor,
            'created_at' => Dates::iso($token->createdAt),
        ];
    }

    private static function number(float $value): int|float
    {
        return floor($value) === $value ? (int) $value : $value;
    }
}
