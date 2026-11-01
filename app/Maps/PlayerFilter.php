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
 * - P9 (etapes P09 D3, D4): zones never reach a player; traps and secrets only once revealed, a
 *   secret passage not revealed being a plain wall exactly like a secret door; a pin with a note
 *   follows the note, without note its visibility; props.note is null unless the note is visible
 *   to the reader ($visibleNotes, refusal by default);
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
     * @param list<string>               $visibleNotes uids of the notes the reader sees
     * @return list<array<string, mixed>>
     */
    public static function objects(array $objects, array $revealed = [], array $hiddenTokens = [], array $visibleNotes = []): array
    {
        $noteShown = array_fill_keys($visibleNotes, true);
        $isRevealed = array_fill_keys($revealed, true);
        $isHidden = array_fill_keys($hiddenTokens, true);
        $out = [];
        foreach ($objects as $object) {
            $uid = (string) ($object['uid'] ?? '');
            $shown = isset($isRevealed[$uid]);
            if (ObjectRulesNotes::handles($object['type'] ?? null)) {
                $seen = self::noteObject($object, $shown, $noteShown);
                if ($seen !== null) {
                    $out[] = $seen;
                }
                continue;
            }
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
     * The version of a pin, zone, trap or secret a reader gets, or null.
     *
     * @param array<string, mixed> $object
     * @param array<string, true>  $noteShown uids of the notes he sees
     * @return array<string, mixed>|null
     */
    private static function noteObject(array $object, bool $shown, array $noteShown): ?array
    {
        $note = $object['props']['note'] ?? null;
        $noteVisible = is_string($note) && isset($noteShown[$note]);
        switch ($object['type']) {
            case 'pin':
                if (is_string($note)) {
                    if (!$noteVisible) {
                        return null;
                    }
                    $object['visibility'] = 'all';
                } elseif (!in_array($object['visibility'] ?? null, $shown ? ['all', 'hidden_until_revealed'] : ['all'], true)) {
                    return null;
                }
                break;
            case 'trap':
                if (!$shown) {
                    return null;
                }
                break;
            case 'secret':
                if (!$shown) {
                    return ($object['props']['kind'] ?? null) === 'passage' ? self::asWall($object) : null;
                }
                break;
            default:
                return null;
        }
        if (($object['layer'] ?? null) === 'gm') {
            return null;
        }
        $object['props']['note'] = $noteVisible ? $note : null;

        return $object;
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
     * A secret door or passage seen by a player: a plain stone wall along it.
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
