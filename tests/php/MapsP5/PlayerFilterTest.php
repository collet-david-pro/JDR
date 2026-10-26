<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

use JDR\Maps\PlayerFilter;
use PHPUnit\Framework\TestCase;

/**
 * What players may receive (projet.md 12.4; prepared in P5 for P6): no gm layer, no hidden
 * object unless revealed, no hidden token, secret doors seen as plain walls.
 */
final class PlayerFilterTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function object(string $uid, string $type, array $over = []): array
    {
        $geometry = match ($type) {
            'wall' => ['points' => [[0, 0], [1, 0]], 'closed' => false],
            'light' => ['x' => 1, 'y' => 1],
            default => ['a' => [2, 3], 'b' => [4, 3.5]],
        };
        $props = match ($type) {
            'door' => ['state' => 'closed', 'locked' => true, 'secret' => false, 'asset_open' => null, 'asset_closed' => null, 'swing' => 'a'],
            default => ['kind' => 'glass'],
        };

        return array_replace([
            'uid' => $uid,
            'floor' => '7',
            'type' => $type,
            'layer' => $type === 'light' ? 'lighting' : 'walls',
            'geometry' => $geometry,
            'props' => $props,
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 4,
            'rev' => 3,
        ], $over);
    }

    public function testObjectsSeenByPlayers(): void
    {
        $door = self::object('door', 'door');
        $secret = self::object('secret', 'door', ['locked' => true]);
        $secret['props']['secret'] = true;
        $objects = [
            self::object('wall', 'wall'),
            $door,
            $secret,
            self::object('gm-light', 'light', ['layer' => 'gm']),
            self::object('gm-only', 'window', ['visibility' => 'gm']),
            self::object('hidden', 'window', ['visibility' => 'hidden_until_revealed']),
            self::object('revealed', 'window', ['visibility' => 'hidden_until_revealed']),
            self::object('gm-revealed', 'window', ['visibility' => 'gm']),
        ];
        $out = PlayerFilter::objects($objects, ['revealed', 'gm-revealed']);

        self::assertSame(['wall', 'door', 'secret', 'revealed'], array_column($out, 'uid'));
        self::assertSame($objects[0], $out[0]);
        self::assertSame($door, $out[1], 'a normal door is sent as it is');
        self::assertSame([
            'uid' => 'secret',
            'floor' => '7',
            'type' => 'wall',
            'layer' => 'walls',
            'geometry' => ['points' => [[2, 3], [4, 3.5]], 'closed' => false],
            'props' => [
                'kind' => 'stone',
                'thickness' => 0.15,
                'blocks_vision' => true,
                'blocks_light' => true,
                'blocks_move' => true,
                'texture_asset' => null,
                'height' => null,
            ],
            'visibility' => 'all',
            'locked' => true,
            'sort_order' => 4,
            'rev' => 3,
        ], $out[2], 'nothing tells a secret door apart from a wall');
        self::assertStringNotContainsString('secret', json_encode($out[2]['props'], JSON_THROW_ON_ERROR));

        // A revealed secret door is a door again.
        self::assertSame($secret, PlayerFilter::objects([$secret], ['secret'])[0]);
        // The gm layer is never sent, even revealed.
        self::assertSame([], PlayerFilter::objects([self::object('x', 'light', ['layer' => 'gm'])], ['x']));
        self::assertSame([], PlayerFilter::objects([]));
    }

    public function testHiddenTokensAreRemoved(): void
    {
        $tokens = [
            ['uid' => 'a', 'hidden' => false, 'x' => 1],
            ['uid' => 'b', 'hidden' => true, 'x' => 2],
            ['uid' => 'c', 'hidden' => false, 'x' => 3],
        ];
        self::assertSame([$tokens[0], $tokens[2]], PlayerFilter::tokens($tokens));
    }
}
