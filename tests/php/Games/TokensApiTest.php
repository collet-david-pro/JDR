<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

/**
 * Token definitions: payload, defaults, validation, partial vision/light, players, soft delete.
 */
final class TokensApiTest extends GamesTestCase
{
    public function testCreateFullAndDefaults(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $bobId = $this->addMember($alice, $game['id'], 'Bob')['user']['id'];
        $asset = $this->uploadOk($alice, 'valid_png_transparent.png', ['kind' => 'token']);

        $token = $this->newToken($alice, $game['id'], [
            'name' => ' Aria ',
            'kind' => 'pc',
            'asset_id' => $asset['id'],
            'size_w' => 1.5,
            'size_h' => 2,
            'default_owner_user_id' => $bobId,
            'vision' => ['enabled' => true, 'range' => 24, 'dark' => 12.5],
            'light' => ['radius' => 4, 'dim_radius' => 8, 'color' => '#FFCC66', 'intensity' => 0.5, 'flicker' => true],
            'ring_color' => '#2F5BD3',
        ]);
        self::assertSame($game['id'], $token['game_id']);
        self::assertSame('Aria', $token['name']);
        self::assertSame('pc', $token['kind']);
        self::assertSame($asset['id'], $token['asset_id']);
        self::assertStringContainsString('/files/' . $asset['uuid'] . '?t=full', $token['image']['full']);
        self::assertStringContainsString('/files/' . $asset['uuid'] . '?t=thumb', $token['image']['thumb']);
        self::assertSame(1.5, $token['size_w']);
        self::assertSame(2, $token['size_h']);
        self::assertSame($bobId, $token['default_owner_user_id']);
        self::assertSame(['enabled' => true, 'range' => 24, 'dark' => 12.5], $token['vision']);
        self::assertSame(['radius' => 4, 'dim_radius' => 8, 'color' => '#ffcc66', 'intensity' => 0.5, 'flicker' => true], $token['light']);
        self::assertSame('#2f5bd3', $token['ring_color']);

        $plain = $this->newToken($alice, $game['id'], ['name' => 'Coffre', 'kind' => 'object']);
        self::assertNull($plain['asset_id']);
        self::assertNull($plain['image']);
        self::assertSame(1, $plain['size_w']);
        self::assertSame(['enabled' => true, 'range' => 12, 'dark' => 0], $plain['vision']);
        self::assertNull($plain['light']);
        self::assertNull($plain['ring_color']);
        self::assertNull($plain['default_owner_user_id']);
        self::assertSame(2, self::data($alice->get('/games/' . $game['id']))['counts']['tokens']);
        self::assertSame(['Aria', 'Coffre'], array_column(self::data($alice->get('/games/' . $game['id'] . '/tokens')), 'name'));
    }

    public function testValidation(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $path = '/games/' . $game['id'] . '/tokens';
        $bob = $this->user('Bob');
        $foreign = $this->uploadOk($bob, 'valid_png_opaque.png');

        self::assertFieldErrors($alice->post($path, []), ['name' => 'required', 'kind' => 'required']);
        self::assertFieldErrors($alice->post($path, ['name' => str_repeat('n', 81), 'kind' => 'dragon']), ['name' => 'too_long', 'kind' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'size_w' => 0.2, 'size_h' => 21]), [
            'size_w' => 'too_small',
            'size_h' => 'too_large',
        ]);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'size_w' => '1']), ['size_w' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'vision' => ['range' => 1001, 'dark' => -1, 'enabled' => 1]]), [
            'vision.range' => 'too_large',
            'vision.dark' => 'too_small',
            'vision.enabled' => 'invalid',
        ]);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'vision' => ['eyes' => 2]]), ['vision' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'light' => [
            'radius' => 1001, 'color' => 'red', 'intensity' => 1.5, 'flicker' => 'no',
        ]]), [
            'light.radius' => 'too_large',
            'light.color' => 'invalid',
            'light.intensity' => 'too_large',
            'light.flicker' => 'invalid',
        ]);
        // dim_radius is the outer radius of the dim light: never below the bright radius.
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'light' => ['radius' => 10, 'dim_radius' => 5]]), [
            'light.dim_radius' => 'below_radius',
        ]);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'ring_color' => '#fff']), ['ring_color' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'asset_id' => $foreign['id']]), ['asset_id' => 'not_found']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'asset_id' => 'abc']), ['asset_id' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'kind' => 'npc', 'default_owner_user_id' => (string) $this->userId('Bob')]), [
            'default_owner_user_id' => 'not_found',
        ]);
        self::assertSame(0, $this->rows('tokens'));

        // Upper bounds accepted; the GM may own a token.
        $max = $this->newToken($alice, $game['id'], [
            'size_w' => 20, 'size_h' => 0.25,
            'vision' => ['range' => 1000, 'dark' => 1000],
            'light' => ['radius' => 1000, 'dim_radius' => 1000],
            'default_owner_user_id' => (string) $this->userId('Alice'),
        ]);
        self::assertSame(0.25, $max['size_h']);
        self::assertSame(1000, $max['light']['dim_radius']);
        self::assertSame('#ffcc66', $max['light']['color']);
    }

    public function testPatchIsPartial(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $token = $this->newToken($alice, $game['id'], ['light' => ['radius' => 2, 'dim_radius' => 4, 'color' => '#112233']]);
        $path = '/tokens/' . $token['id'];

        $patched = self::data($alice->patch($path, ['vision' => ['range' => 30], 'light' => ['intensity' => 1]]));
        self::assertSame(['enabled' => true, 'range' => 30, 'dark' => 0], $patched['vision']);
        self::assertSame(['radius' => 2, 'dim_radius' => 4, 'color' => '#112233', 'intensity' => 1, 'flicker' => false], $patched['light']);
        self::assertSame('Gobelin', $patched['name']);
        self::assertFieldErrors($alice->patch($path, ['light' => ['radius' => 5]]), ['light.dim_radius' => 'below_radius']);
        self::assertFieldErrors($alice->patch($path, ['name' => null]), ['name' => 'required']);
        $patched = self::data($alice->patch($path, ['light' => null, 'ring_color' => '#00ff00', 'kind' => 'npc']));
        self::assertNull($patched['light']);
        self::assertSame('#00ff00', $patched['ring_color']);
        self::assertSame('npc', $patched['kind']);
        self::assertSame(200, $alice->patch($path, [])->status());
    }

    public function testPlayersSeeOnlyTheirTokens(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $bobId = $this->addMember($alice, $game['id'], 'Bob')['user']['id'];
        $mine = $this->newToken($alice, $game['id'], ['name' => 'Héros de Bob', 'kind' => 'pc', 'default_owner_user_id' => $bobId]);
        $monster = $this->newToken($alice, $game['id'], ['name' => 'Dragon caché']);
        $bob = $this->client('198.51.100.130');
        $bob->login('Bob', self::PASSWORD);

        $list = $bob->get('/games/' . $game['id'] . '/tokens');
        self::assertSame([$mine['id']], array_column(self::data($list), 'id'));
        self::assertStringNotContainsString('Dragon caché', $list->body());
        self::assertSame(1, self::data($bob->get('/games/' . $game['id']))['counts']['tokens']);
        self::assertSame(200, $bob->get('/tokens/' . $mine['id'])->status());
        self::assertSame(403, $bob->get('/tokens/' . $monster['id'])->status());
        self::assertSame(403, $bob->patch('/tokens/' . $mine['id'], ['name' => 'x'])->status());
        self::assertSame(2, self::data($alice->get('/games/' . $game['id']))['counts']['tokens']);
    }

    public function testDeleteIsSoftAndLeavesEncounters(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $token = $this->newToken($alice, $game['id']);
        $other = $this->newToken($alice, $game['id'], ['name' => 'Orque']);
        $encounter = self::data($alice->post('/games/' . $game['id'] . '/encounters', [
            'name' => 'Combat',
            'tokens' => [['token_id' => $token['id'], 'dx' => 0, 'dy' => 0], ['token_id' => $other['id'], 'dx' => 1, 'dy' => 1]],
        ]));
        self::assertCount(2, $encounter['tokens']);

        self::assertSame(204, $alice->delete('/tokens/' . $token['id'])->status());
        self::assertSame(404, $alice->get('/tokens/' . $token['id'])->status());
        self::assertSame(404, $alice->delete('/tokens/' . $token['id'])->status());
        self::assertSame(['Orque'], array_column(self::data($alice->get('/games/' . $game['id'] . '/tokens')), 'name'));
        self::assertSame([$other['id']], array_column(self::data($alice->get('/games/' . $game['id'] . '/encounters'))[0]['tokens'], 'token_id'));
        self::assertSame(1, $this->rows('tokens', '`deleted_at` IS NOT NULL'));
    }
}
