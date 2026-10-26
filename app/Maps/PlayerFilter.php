<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * What a player (or a projection screen) may receive of a map's objects and placed tokens
 * (projet.md 12.4, 10.2; prepared in P5, used by the sessions of P6). Pure: works on the API
 * forms of objects and placed tokens.
 * - objects of the "gm" layer are removed;
 * - objects whose visibility is not "all" are removed, except "hidden_until_revealed" objects
 *   that were revealed (uids given by the caller, from map_objects.revealed_at);
 * - a secret door that is not revealed becomes a plain wall (same uid, floor, sort_order, rev):
 *   {type: wall, layer: walls, geometry {points: [a, b], closed: false}, props: stone 0.15,
 *   blocking vision, light and movement};
 * - hidden placed tokens are removed;
 * - a light following a hidden token (props.follows_token) loses that link (P6c: the uid of a
 *   hidden token never reaches a player).
 */
final class PlayerFilter
{
    public const SECRET_WALL_PROPS = [
        'kind' => 'stone',
        'thickness' => 0.15,
        'blocks_vision' => true,
        'blocks_light' => true,
        'blocks_move' => true,
        'texture_asset' => null,
        'height' => null,
    ];

    /**
     * @param list<array<string, mixed>> $objects
     * @param list<string>               $revealed     uids of revealed objects
     * @param list<string>               $hiddenTokens uids of the hidden placed tokens of the map
     * @return list<array<string, mixed>>
     */
    public static function objects(array $objects, array $revealed = [], array $hiddenTokens = []): array
    {
        $isRevealed = array_fill_keys($revealed, true);
        $isHidden = array_fill_keys($hiddenTokens, true);
        $out = [];
        foreach ($objects as $object) {
            $uid = (string) ($object['uid'] ?? '');
            $shown = isset($isRevealed[$uid]);
            if (($object['layer'] ?? null) === 'gm') {
                continue;
            }
            $visibility = $object['visibility'] ?? 'all';
            if ($visibility !== 'all' && !($visibility === 'hidden_until_revealed' && $shown)) {
                continue;
            }
            if (($object['type'] ?? null) === 'door' && ($object['props']['secret'] ?? false) === true && !$shown) {
                $object = self::asWall($object);
            }
            $follows = $object['props']['follows_token'] ?? null;
            if (($object['type'] ?? null) === 'light' && is_string($follows) && isset($isHidden[$follows])) {
                $object['props']['follows_token'] = null;
            }
            $out[] = $object;
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $tokens
     * @return list<array<string, mixed>>
     */
    public static function tokens(array $tokens): array
    {
        return array_values(array_filter($tokens, static fn (array $t): bool => ($t['hidden'] ?? false) !== true));
    }

    /**
     * A secret door seen by a player: a plain stone wall along the door.
     *
     * @param array<string, mixed> $door
     * @return array<string, mixed>
     */
    public static function asWall(array $door): array
    {
        return [
            'uid' => $door['uid'],
            'floor' => $door['floor'],
            'type' => 'wall',
            'layer' => 'walls',
            'geometry' => ['points' => [$door['geometry']['a'], $door['geometry']['b']], 'closed' => false],
            'props' => self::SECRET_WALL_PROPS,
            'visibility' => 'all',
            'locked' => (bool) ($door['locked'] ?? false),
            'sort_order' => (int) ($door['sort_order'] ?? 0),
            'rev' => (int) ($door['rev'] ?? 1),
        ];
    }
}
