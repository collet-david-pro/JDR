<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapRepository;
use JDR\Maps\ChunkCodec;
use JDR\Maps\ChunkCodecException;
use JDR\Maps\PlayerFilter;

/**
 * What a player of a session is given of a map (snapshot, preload): PlayerFilter (calque "gm",
 * visibility, secret doors, hidden tokens) then the game settings (players_see_other_pcs) and,
 * under fog_strict, the FogScope (blocks, objects by bounding box, tokens by position).
 * Nothing hidden may come out of this class: it is the filter of the snapshot.
 */
final class PlayerView
{
    private const MAX_SQL_CELLS = 400;

    public function __construct(private MapRepository $maps)
    {
    }

    /**
     * Placed tokens (API form) a player sees: not hidden, not another player's token when
     * players_see_other_pcs is off, and (fog_strict) his own or inside his scope.
     *
     * @param list<array<string, mixed>> $placed
     * @param array<int, int>            $assignments token definition id => user id
     * @return list<array<string, mixed>>
     */
    public function tokens(SessionContext $ctx, int $userId, array $placed, FogScope $scope, array $assignments): array
    {
        $seeOthers = $ctx->setting('players_see_other_pcs');
        $out = [];
        foreach (PlayerFilter::tokens($placed) as $token) {
            $owner = $assignments[(int) $token['token_id']] ?? null;
            if ($owner !== $userId) {
                if (!$seeOthers && $owner !== null) {
                    continue;
                }
                if (!$scope->allowsPoint((int) $token['floor'], (float) $token['x'], (float) $token['y'])) {
                    continue;
                }
            }
            $out[] = $token;
        }

        return $out;
    }

    /**
     * Objects (API form, every floor) a player sees.
     *
     * @param list<array<string, mixed>>                                        $objects
     * @param list<string>                                                      $revealed uids
     * @param array<string, array{0: float, 1: float, 2: float, 3: float}>      $bboxes uid => box (only read when restricted)
     * @return list<array<string, mixed>>
     */
    public function objects(array $objects, array $revealed, FogScope $scope, array $bboxes): array
    {
        $out = PlayerFilter::objects($objects, $revealed);
        if (!$scope->isRestricted()) {
            return $out;
        }

        return array_values(array_filter($out, static function (array $o) use ($scope, $bboxes): bool {
            $box = $bboxes[(string) $o['uid']] ?? null;

            return $box !== null && $scope->allowsBox((int) $o['floor'], $box);
        }));
    }

    /**
     * Asset ids of the palette a player may fetch: all of them, or (fog_strict) those used by the
     * tiles of the blocks of his scope.
     *
     * @return list<int>
     */
    public function paletteAssetIds(Map $map, FogScope $scope): array
    {
        $used = null;
        if ($scope->isRestricted()) {
            $used = [];
            foreach ($scope->floors() as $floorId) {
                $cells = $scope->cells($floorId) ?? [];
                $read = count($cells) > self::MAX_SQL_CELLS ? null : $cells;
                foreach ($this->maps->readChunks($map->id, $floorId, MapInput::TILE_LAYERS, $read) as $chunk) {
                    if ($read === null && !$scope->allowsBlock($floorId, $chunk['cx'], $chunk['cy'])) {
                        continue;
                    }
                    try {
                        $raw = ChunkCodec::decode($chunk['data'], $chunk['layer'], $map->paletteSize());
                    } catch (ChunkCodecException) {
                        continue;
                    }
                    foreach (array_keys(ChunkCodec::indexCounts($raw)) as $index) {
                        $used[(int) $index] = true;
                    }
                }
            }
        }
        $ids = [];
        foreach ($map->palette as $index => $entry) {
            if ($entry !== null && ($used === null || isset($used[$index]))) {
                $ids[$entry['asset_id']] = $entry['asset_id'];
            }
        }

        return array_values($ids);
    }
}
