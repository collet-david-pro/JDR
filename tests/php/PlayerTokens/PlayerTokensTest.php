<?php

declare(strict_types=1);

namespace JDR\Tests\PlayerTokens;

use JDR\Tests\Sessions\SessionsTestCase;

/**
 * Player-made tokens: collection (limit, rename, duplicate, delete), choice per game (out of
 * session only), effective image on the game's token definition, GM override, rights.
 */
final class PlayerTokensTest extends SessionsTestCase
{
    private const DESIGN = '{"v":1,"shape":"disc","bg":"#336699"}';

    /**
     * @return array<string, mixed> PlayerToken
     */
    private function make(\JDR\Tests\Api\ApiClient $c, string $name = 'Aria', string $fixture = 'valid_png_transparent.png', int $status = 201): array
    {
        $r = $c->upload('/me/player-tokens', self::fixture($fixture), ['name' => $name, 'design' => self::DESIGN]);
        self::assertSame($status, $r->status(), $r->body());

        return $status === 201 ? self::data($r) : [];
    }

    public function testCollectionLifecycleAndQuota(): void
    {
        $bob = $this->user('Bob');
        $before = $this->usedBytes('Bob');
        $t = $this->make($bob);
        self::assertSame('Aria', $t['name']);
        self::assertSame(['v' => 1, 'shape' => 'disc', 'bg' => '#336699'], $t['design']);
        self::assertStringContainsString('/files/', $t['image']['full']);
        self::assertGreaterThan($before, $this->usedBytes('Bob'));
        // Hidden from the asset library.
        self::assertSame([], self::data($bob->get('/assets?scope=mine')));

        $list = $bob->get('/me/player-tokens');
        self::assertSame(100, $list->payload()['meta']['max']);
        self::assertSame(['Aria'], array_column(self::data($list), 'name'));

        self::assertSame('Zoe', self::data($bob->patch('/me/player-tokens/' . $t['id'], ['name' => 'Zoe']))['name']);
        $copy = self::data($this->ok($bob->post('/me/player-tokens/' . $t['id'] . '/duplicate', ['name' => 'Zoe bis']), 201));
        self::assertSame('Zoe bis', $copy['name']);
        $assets = $this->rows('assets', '`source` = ?', ['player_token']);
        self::assertSame(1, $assets, 'the copy shares the image');

        // Re-edit: a new image replaces the old one for that token only.
        $r = $bob->upload('/me/player-tokens/' . $t['id'] . '/design', self::fixture('valid_apng.png'), ['design' => self::DESIGN]);
        self::assertSame(422, $r->status(), 'animated image refused');
        $this->ok($bob->delete('/me/player-tokens/' . $t['id']), 204);
        self::assertSame(1, $this->rows('assets', '`source` = ? AND `deleted_at` IS NULL', ['player_token']), 'still used by the copy');
        $this->ok($bob->delete('/me/player-tokens/' . $copy['id']), 204);
        self::assertSame(0, $this->rows('assets', '`source` = ? AND `deleted_at` IS NULL', ['player_token']));
        self::assertSame($before, $this->usedBytes('Bob'));
    }

    public function testValidation(): void
    {
        $bob = $this->user('Bob');
        $r = $bob->upload('/me/player-tokens', self::fixture('valid_png_opaque.png'), ['name' => 'X', 'design' => self::DESIGN]);
        self::assertSame(422, $r->status(), 'not square');
        $r = $bob->upload('/me/player-tokens', self::fixture('valid_png_transparent.png'), ['name' => '', 'design' => self::DESIGN]);
        self::assertSame(422, $r->status());
        $r = $bob->upload('/me/player-tokens', self::fixture('valid_png_transparent.png'), ['name' => 'X', 'design' => 'not json']);
        self::assertSame(422, $r->status());
        $r = $bob->upload('/me/player-tokens', self::fixture('trap_php_pure.png'), ['name' => 'X', 'design' => self::DESIGN]);
        self::assertContains($r->status(), [415, 422]);
        self::assertSame(0, $this->rows('player_tokens'));
        self::assertSame(0, $this->rows('assets', '`deleted_at` IS NULL'));
    }

    public function testLimitOf100PerAccount(): void
    {
        $bob = $this->user('Bob');
        $t = $this->make($bob);
        $uid = $this->userId('Bob');
        for ($i = 1; $i < 100; $i++) {
            $this->app->container()->get(\JDR\Core\Db::class)->execute(
                'INSERT INTO ' . $this->app->container()->get(\JDR\Core\Db::class)->t('player_tokens') . ' (`user_id`, `name`, `asset_id`, `source_asset_id`, `design`, `created_at`, `updated_at`) VALUES (?, ?, NULL, NULL, ?, NOW(), NOW())',
                [$uid, 'n' . $i, '{}'],
            );
        }
        $r = $bob->upload('/me/player-tokens', self::fixture('valid_png_transparent.png'), ['name' => 'Cent un', 'design' => self::DESIGN]);
        self::assertSame(409, $r->status());
        self::assertSame('player_token_limit', self::errorCode($r));
        $r = $bob->post('/me/player-tokens/' . $t['id'] . '/duplicate', []);
        self::assertSame('player_token_limit', self::errorCode($r));
        self::assertSame(100, $this->rows('player_tokens', '`user_id` = ?', [$uid]));
    }

    public function testChoiceCreatesTheDefinitionAndTheGmOverridesIt(): void
    {
        $w = $this->arena();
        $bob = $w['bob'];
        $gm = $w['gm'];
        $t = $this->make($bob);
        $gmAsset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'token']);

        $r = $this->ok($bob->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => $t['id']]));
        $def = self::data($r);
        self::assertSame('Bob', $def['name']);
        self::assertSame('pc', $def['kind']);
        self::assertSame((string) $this->userId('Bob'), (string) $def['default_owner_user_id']);
        self::assertSame($t['image']['full'], $def['image']['full'], 'the player image is effective');
        self::assertSame($t['id'], self::data($bob->get('/games/' . $w['game'] . '/my-token'))['id']);

        // Priority on the GM image, GM and player see it through the token list.
        $this->ok($gm->patch('/tokens/' . $def['id'], ['asset_id' => $gmAsset['id']]));
        $seen = self::data($gm->get('/tokens/' . $def['id']));
        self::assertSame($t['image']['full'], $seen['image']['full']);
        self::assertSame($t['id'], $seen['player_token']['id']);
        self::assertStringContainsString($gmAsset['uuid'], $seen['gm_image']['full']);
        $mine = self::data($bob->get('/games/' . $w['game'] . '/tokens'));
        self::assertSame($t['image']['full'], $mine[0]['image']['full']);

        // The GM imposes their image (reversible, nothing destroyed).
        $forced = self::data($gm->patch('/tokens/' . $def['id'], ['gm_image_forced' => true]));
        self::assertStringContainsString($gmAsset['uuid'], $forced['image']['full']);
        self::assertTrue($forced['gm_image_forced']);
        self::assertSame($t['id'], $forced['player_token']['id']);
        $back = self::data($gm->patch('/tokens/' . $def['id'], ['gm_image_forced' => false]));
        self::assertSame($t['image']['full'], $back['image']['full']);
        self::assertSame(422, $gm->patch('/tokens/' . $def['id'], ['gm_image_forced' => 'yes'])->status());

        // A second choice reuses the same definition; clearing falls back on the GM's image.
        $this->ok($bob->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => null]));
        self::assertSame(1, $this->rows('tokens', '`game_id` = ? AND `default_owner_user_id` = ?', [(int) $w['game'], $this->userId('Bob')]));
        $cleared = self::data($gm->get('/tokens/' . $def['id']));
        self::assertStringContainsString($gmAsset['uuid'], $cleared['image']['full']);
        self::assertNull($cleared['player_token']);
    }

    public function testChoiceIsRefusedInSessionButAllowedWhenJoining(): void
    {
        $w = $this->arena();
        $bob = $w['bob'];
        $t = $this->make($bob);
        $this->ok($bob->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => $t['id']]));
        $this->setState($w['session'], 'running');
        $r = $bob->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => null]);
        self::assertSame(409, $r->status());
        self::assertSame('session_in_progress', self::errorCode($r));
        self::assertSame($t['id'], self::data($bob->get('/games/' . $w['game'] . '/my-token'))['id']);

        // Joining with a token (first choice) works even while the session runs; a later one is ignored.
        $dan = $w['dan'];
        $d = $this->make($dan, 'Dan');
        $this->ok($dan->post('/sessions/join', ['code' => $w['code'], 'player_token_id' => $d['id']]));
        self::assertSame($d['id'], self::data($dan->get('/games/' . $w['game'] . '/my-token'))['id']);
        $d2 = $this->make($dan, 'Dan2');
        $this->ok($dan->post('/sessions/join', ['code' => $w['code'], 'player_token_id' => $d2['id']]));
        self::assertSame($d['id'], self::data($dan->get('/games/' . $w['game'] . '/my-token'))['id']);
        // A token that is not yours is a validation error.
        $r = $w['eve']->post('/sessions/join', ['code' => $w['code'], 'player_token_id' => $t['id']]);
        self::assertSame(422, $r->status());
        self::assertSame(0, $this->rows('game_members', '`user_id` = ?', [$this->userId('Eve')]) , 'rolled back');
    }

    public function testDeleteUsedTokenAsksConfirmationAndFallsBack(): void
    {
        $w = $this->arena();
        $bob = $w['bob'];
        $gm = $w['gm'];
        $t = $this->make($bob);
        $def = self::data($this->ok($bob->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => $t['id']])));
        $r = $bob->delete('/me/player-tokens/' . $t['id']);
        self::assertSame(409, $r->status());
        self::assertSame('player_token_in_use', self::errorCode($r));
        self::assertSame(1, $this->rows('player_tokens'));
        $this->ok($bob->delete('/me/player-tokens/' . $t['id'] . '?force=1'), 204);
        $after = self::data($gm->get('/tokens/' . $def['id']));
        self::assertNull($after['image']);
        self::assertNull($after['player_token']);
        self::assertNull(self::data($bob->get('/games/' . $w['game'] . '/my-token')));
    }

    public function testRights(): void
    {
        $w = $this->arena();
        $bob = $w['bob'];
        $eve = $w['eve'];
        $t = $this->make($bob);
        // Another account cannot read, change, copy, delete or pick someone else's token.
        self::assertSame(404, $eve->get('/me/player-tokens/' . $t['id'])->status());
        self::assertSame(404, $eve->patch('/me/player-tokens/' . $t['id'], ['name' => 'Pwn'])->status());
        self::assertSame(404, $eve->post('/me/player-tokens/' . $t['id'] . '/duplicate', [])->status());
        self::assertSame(404, $eve->delete('/me/player-tokens/' . $t['id'])->status());
        self::assertSame(404, $eve->upload('/me/player-tokens/' . $t['id'] . '/design', self::fixture('valid_png_transparent.png'), ['design' => self::DESIGN])->status());
        self::assertSame([], self::data($eve->get('/me/player-tokens')));
        // A non-member cannot choose in a game nor read the choice (404); a member cannot pick another's token.
        self::assertSame(404, $eve->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => null])->status());
        self::assertSame(404, $eve->get('/games/' . $w['game'] . '/my-token')->status());
        $dan = $w['dan'];
        $r = $dan->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => $t['id']]);
        self::assertSame(422, $r->status());
        self::assertSame('Aria', self::data($bob->get('/me/player-tokens/' . $t['id']))['name']);
        // Only the GM or a co-GM imposes their image; a player cannot patch the definition.
        $def = self::data($this->ok($bob->put('/games/' . $w['game'] . '/my-token', ['player_token_id' => $t['id']])));
        self::assertSame(403, $bob->patch('/tokens/' . $def['id'], ['gm_image_forced' => true])->status());
        self::assertSame(200, $w['co']->patch('/tokens/' . $def['id'], ['gm_image_forced' => true])->status());
        self::assertSame(401, $w['anon']->get('/me/player-tokens')->status());
        // The player image is not visible in other members' lists.
        self::assertSame([], self::data($w['dan']->get('/games/' . $w['game'] . '/tokens')));
    }

    public function testAccountDeletionRemovesTheCollection(): void
    {
        $bob = $this->user('Bob');
        $this->make($bob);
        self::assertSame(1, $this->rows('player_tokens'));
        self::assertSame(204, $bob->delete('/me', ['password' => self::PASSWORD])->status());
        self::assertSame(0, $this->rows('player_tokens'));
    }
}
