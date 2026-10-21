<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

/**
 * Assets of a game (contract P3 / D8): GET /assets?scope=game:{id} and the signed URLs.
 * GM and co-GM: every asset used by the game; player: the cover and the images of the tokens
 * they own by default only (no GM content sent to a player); strangers: nothing.
 */
final class GameAssetsTest extends GamesTestCase
{
    public function testGameScopeFollowsTheRoleOfTheViewer(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $bobId = $this->addMember($alice, $game['id'], 'Bob')['user']['id'];
        $this->addMember($alice, $game['id'], 'Carol', 'co_gm');
        $hero = $this->uploadOk($alice, 'valid_png_transparent.png', ['kind' => 'token']);
        $monster = $this->uploadOk($alice, 'valid_gif_static.gif', ['kind' => 'token']);
        $cover = $this->uploadOk($alice, 'valid_webp_lossy.webp', ['kind' => 'background']);
        $unused = $this->uploadOk($alice, 'valid_png_opaque.png');
        $alice->patch('/games/' . $game['id'], ['cover_asset_id' => $cover['id']]);
        $heroToken = $this->newToken($alice, $game['id'], ['name' => 'Héros', 'kind' => 'pc', 'asset_id' => $hero['id'], 'default_owner_user_id' => $bobId]);
        $this->newToken($alice, $game['id'], ['name' => 'Dragon', 'asset_id' => $monster['id']]);
        $scope = '/assets?scope=game:' . $game['id'];
        $ids = static fn (array $assets): array => array_column($assets, 'id');

        // GM and co-GM: cover + every token image (not the unused asset).
        $all = [$cover['id'], $monster['id'], $hero['id']];
        self::assertEqualsCanonicalizing($all, $ids(self::data($alice->get($scope))));
        $carol = $this->client('198.51.100.140');
        $carol->login('Carol', self::PASSWORD);
        self::assertEqualsCanonicalizing($all, $ids(self::data($carol->get($scope))));
        self::assertSame([$monster['id']], $ids(self::data($carol->get($scope . '&q=gif'))));
        self::assertSame(200, $carol->get('/assets/' . $monster['id'])->status());
        self::assertSame(404, $carol->get('/assets/' . $unused['id'])->status());
        self::assertSame(403, $carol->patch('/assets/' . $monster['id'], ['name' => 'x'])->status());

        // Player: cover + own token image only, in the list, by id, and in the game / tokens.
        $bob = $this->client('198.51.100.141');
        $bob->login('Bob', self::PASSWORD);
        $listed = self::data($bob->get($scope));
        self::assertEqualsCanonicalizing([$cover['id'], $hero['id']], $ids($listed));
        self::assertStringNotContainsString($monster['uuid'], $bob->get($scope)->body());
        self::assertSame(200, $bob->get('/assets/' . $hero['id'])->status());
        self::assertSame(404, $bob->get('/assets/' . $monster['id'])->status());
        self::assertSame(404, $bob->get('/assets/' . $unused['id'])->status());
        $gameForBob = self::data($bob->get('/games/' . $game['id']));
        self::assertNotNull($gameForBob['cover_url']);
        $tokensForBob = $bob->get('/games/' . $game['id'] . '/tokens');
        self::assertSame([$heroToken['id']], array_column(self::data($tokensForBob), 'id'));
        self::assertStringNotContainsString($monster['uuid'], $tokensForBob->body());

        // The signed URLs delivered to the player work (signature = authorization).
        foreach ([$gameForBob['cover_url'], self::data($tokensForBob)[0]['image']['full'], $listed[0]['urls']['thumb']] as $url) {
            self::assertSame(200, $this->client()->get(self::apiPath($url))->status(), $url);
        }

        // The co-GM may reuse an asset of the game for a token, not an unused personal asset of the GM.
        $carolToken = $carol->post('/games/' . $game['id'] . '/tokens', ['name' => 'Copie', 'kind' => 'monster', 'asset_id' => $monster['id']]);
        self::assertSame(201, $carolToken->status());
        self::assertFieldErrors(
            $carol->post('/games/' . $game['id'] . '/tokens', ['name' => 'Vol', 'kind' => 'monster', 'asset_id' => $unused['id']]),
            ['asset_id' => 'not_found'],
        );

        // Leaving the game closes the access.
        self::assertSame(204, $bob->delete('/games/' . $game['id'] . '/members/' . $bobId)->status());
        self::assertSame(404, $bob->get($scope)->status());
        self::assertSame(404, $bob->get('/assets/' . $cover['id'])->status());
        self::assertSame(404, $bob->get('/assets/' . $hero['id'])->status());

        // A game in the trash shares nothing any more, even with the co-GM.
        $alice->delete('/games/' . $game['id']);
        self::assertSame(404, $carol->get($scope)->status());
        self::assertSame(404, $carol->get('/assets/' . $monster['id'])->status());
    }

    public function testStrangersGetNothing(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png', ['kind' => 'token']);
        $this->newToken($alice, $game['id'], ['asset_id' => $asset['id']]);
        $dave = $this->user('Dave');
        self::assertSame(404, $dave->get('/assets?scope=game:' . $game['id'])->status());
        self::assertSame(404, $dave->get('/assets/' . $asset['id'])->status());
        self::assertSame(404, $dave->get('/assets?scope=game:999999')->status());
        self::assertFieldErrors($dave->get('/assets?scope=game:'), ['scope' => 'invalid']);
    }
}
