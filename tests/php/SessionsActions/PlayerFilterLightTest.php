<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

use JDR\Maps\PlayerFilter;
use PHPUnit\Framework\TestCase;

/**
 * P6c fix: a light that follows a hidden token does not give its uid to the players.
 */
final class PlayerFilterLightTest extends TestCase
{
    public function testFollowedHiddenTokenIsForgotten(): void
    {
        $light = [
            'uid' => 'l1', 'floor' => '1', 'type' => 'light', 'layer' => 'lighting', 'geometry' => ['x' => 1, 'y' => 1],
            'props' => ['radius' => 1, 'dim_radius' => 2, 'color' => '#ffffff', 'intensity' => 1, 'flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 1],
                'cone' => null, 'enabled' => true, 'follows_token' => 't-dragon'],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0, 'rev' => 1,
        ];
        self::assertNull(PlayerFilter::objects([$light], [], ['t-dragon'])[0]['props']['follows_token']);
        self::assertSame('t-dragon', PlayerFilter::objects([$light], [], ['t-other'])[0]['props']['follows_token']);
        self::assertSame('t-dragon', PlayerFilter::objects([$light])[0]['props']['follows_token']);
    }
}
