<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

/**
 * /games: create, validation of the settings, update, lists, archive, trash, restore.
 */
final class GamesApiTest extends GamesTestCase
{
    public function testCreateWithDefaults(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice, '  La Tour  ');
        self::assertIsString($game['id']);
        self::assertSame('La Tour', $game['name']);
        self::assertNull($game['description']);
        self::assertNull($game['cover_asset_id']);
        self::assertNull($game['cover_url']);
        self::assertSame(['id' => (string) $this->userId('Alice'), 'username' => 'Alice'], $game['gm']);
        self::assertSame('gm', $game['my_role']);
        self::assertSame([
            'fog_strict' => true,
            'players_blocked_by_walls' => true,
            'players_can_move_own_tokens' => true,
            'players_see_other_pcs' => true,
            'unit_label' => 'ft',
            'unit_per_cell' => 5,
            'default_cell_px' => 70,
        ], $game['settings']);
        self::assertSame(['maps' => 0, 'tokens' => 0, 'members' => 1], $game['counts']);
        self::assertNull($game['archived_at']);
        self::assertNull($game['deleted_at']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $game['created_at']);
        // The GM has no game_members row (games.gm_user_id).
        self::assertSame(0, $this->rows('game_members'));
        self::assertSame(1, self::data($this->user('Admin', 'admin')->get('/admin/stats'))['games']);
    }

    public function testCreateWithSettingsAndValidation(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice, 'Mètres', [
            'description' => "Ligne 1\nLigne 2",
            'settings' => ['unit_label' => 'm', 'unit_per_cell' => 1.5, 'default_cell_px' => 100, 'fog_strict' => false],
        ]);
        self::assertSame("Ligne 1\nLigne 2", $game['description']);
        self::assertSame('m', $game['settings']['unit_label']);
        self::assertSame(1.5, $game['settings']['unit_per_cell']);
        self::assertSame(100, $game['settings']['default_cell_px']);
        self::assertFalse($game['settings']['fog_strict']);
        self::assertTrue($game['settings']['players_see_other_pcs']);

        self::assertFieldErrors($alice->post('/games', []), ['name' => 'required']);
        self::assertFieldErrors($alice->post('/games', ['name' => str_repeat('a', 121)]), ['name' => 'too_long']);
        self::assertFieldErrors($alice->post('/games', ['name' => ['x']]), ['name' => 'invalid']);
        self::assertFieldErrors($alice->post('/games', ['name' => 'x', 'description' => str_repeat('d', 5001)]), ['description' => 'too_long']);
        self::assertFieldErrors($alice->post('/games', ['name' => 'x', 'settings' => ['dragons' => true]]), ['settings' => 'invalid']);
        self::assertFieldErrors($alice->post('/games', ['name' => 'x', 'settings' => [1, 2]]), ['settings' => 'invalid']);
        self::assertFieldErrors($alice->post('/games', ['name' => 'x', 'settings' => [
            'fog_strict' => 'yes',
            'unit_label' => 'kilomètres!',
            'unit_per_cell' => 0,
            'default_cell_px' => 513,
        ]]), [
            'settings.fog_strict' => 'invalid',
            'settings.unit_label' => 'too_long',
            'settings.unit_per_cell' => 'too_small',
            'settings.default_cell_px' => 'too_large',
        ]);
        self::assertFieldErrors($alice->post('/games', ['name' => 'x', 'settings' => [
            'unit_label' => ' ',
            'unit_per_cell' => 10000,
            'default_cell_px' => 70.5,
        ]]), [
            'settings.unit_label' => 'required',
            'settings.unit_per_cell' => 'too_large',
            'settings.default_cell_px' => 'invalid',
        ]);
        self::assertFieldErrors($alice->post('/games', ['name' => 'x', 'settings' => ['unit_per_cell' => '5']]), ['settings.unit_per_cell' => 'invalid']);
        self::assertSame(9999.99, self::data($alice->post('/games', ['name' => 'x', 'settings' => ['unit_per_cell' => 9999.99]]))['settings']['unit_per_cell']);
        self::assertSame(2, $this->rows('games'));
    }

    public function testPatchMergesSettingsAndSetsCover(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $id = $game['id'];
        $patched = self::data($alice->patch('/games/' . $id, [
            'name' => 'Nouveau nom',
            'description' => '   ',
            'settings' => ['unit_label' => 'm', 'unit_per_cell' => 1.5],
        ]));
        self::assertSame('Nouveau nom', $patched['name']);
        self::assertNull($patched['description']);
        self::assertSame('m', $patched['settings']['unit_label']);
        self::assertSame(70, $patched['settings']['default_cell_px']);
        $patched = self::data($alice->patch('/games/' . $id, ['settings' => ['fog_strict' => false]]));
        self::assertSame('m', $patched['settings']['unit_label']);
        self::assertFalse($patched['settings']['fog_strict']);
        self::assertFieldErrors($alice->patch('/games/' . $id, ['name' => '']), ['name' => 'required']);
        self::assertFieldErrors($alice->patch('/games/' . $id, ['cover_asset_id' => 'abc']), ['cover_asset_id' => 'invalid']);

        // Cover: own asset; the asset of another user or an unknown one is refused.
        $cover = $this->uploadOk($alice, 'valid_png_opaque.png', ['kind' => 'background']);
        $bob = $this->user('Bob');
        $foreign = $this->uploadOk($bob, 'valid_gif_static.gif');
        self::assertFieldErrors($alice->patch('/games/' . $id, ['cover_asset_id' => $foreign['id']]), ['cover_asset_id' => 'not_found']);
        self::assertFieldErrors($alice->patch('/games/' . $id, ['cover_asset_id' => '999999']), ['cover_asset_id' => 'not_found']);
        $withCover = self::data($alice->patch('/games/' . $id, ['cover_asset_id' => $cover['id']]));
        self::assertSame($cover['id'], $withCover['cover_asset_id']);
        self::assertStringContainsString('/files/' . $cover['uuid'] . '?t=thumb', (string) $withCover['cover_url']);
        self::assertSame(200, $this->client()->get(self::apiPath($withCover['cover_url']))->status());
        $noCover = self::data($alice->patch('/games/' . $id, ['cover_asset_id' => null]));
        self::assertNull($noCover['cover_asset_id']);
        self::assertNull($noCover['cover_url']);
    }

    public function testListsArchiveTrashAndRestore(): void
    {
        $alice = $this->user('Alice');
        $bob = $this->user('Bob');
        $mine = $this->newGame($alice, 'Mine');
        $other = $this->newGame($alice, 'Autre');
        $played = $this->newGame($bob, 'Chez Bob');
        $this->addMember($bob, $played['id'], 'Alice');

        $names = static fn (array $games): array => array_column($games, 'name');
        self::assertEqualsCanonicalizing(['Mine', 'Autre', 'Chez Bob'], $names(self::data($alice->get('/games'))));
        self::assertEqualsCanonicalizing(['Mine', 'Autre'], $names(self::data($alice->get('/games?role=gm'))));
        self::assertSame(['Chez Bob'], $names(self::data($alice->get('/games?role=player'))));
        self::assertSame('player', self::data($alice->get('/games?role=player'))[0]['my_role']);
        self::assertFieldErrors($alice->get('/games?role=admin'), ['role' => 'invalid']);
        self::assertFieldErrors($alice->get('/games?state=deleted'), ['state' => 'invalid']);

        // Archive: out of the active list, still usable.
        $archived = self::data($alice->post('/games/' . $other['id'] . '/archive'));
        self::assertNotNull($archived['archived_at']);
        self::assertSame(['Autre'], $names(self::data($alice->get('/games?state=archived'))));
        self::assertNotContains('Autre', $names(self::data($alice->get('/games'))));
        self::assertSame(200, $alice->get('/games/' . $other['id'])->status());

        // Trash: only the GM sees it; restore takes it out of the trash and of the archives.
        self::assertSame(204, $alice->delete('/games/' . $other['id'])->status());
        self::assertSame(204, $alice->delete('/games/' . $other['id'])->status());
        self::assertSame([], self::data($alice->get('/games?state=archived')));
        $trash = self::data($alice->get('/games?state=trash'));
        self::assertSame(['Autre'], $names($trash));
        self::assertNotNull($trash[0]['deleted_at']);
        self::assertNotNull(self::data($alice->get('/games/' . $other['id']))['deleted_at']);
        self::assertSame(404, $alice->get('/games/' . $other['id'] . '/tokens')->status());
        self::assertSame(404, $alice->patch('/games/' . $other['id'], ['name' => 'x'])->status());
        self::assertSame(2, self::data($this->user('Admin', 'admin')->get('/admin/stats'))['games']);

        // Bob's game in the trash: invisible to its player Alice.
        self::assertSame(204, $bob->delete('/games/' . $played['id'])->status());
        self::assertSame(404, $alice->get('/games/' . $played['id'])->status());
        self::assertSame([], self::data($alice->get('/games?role=player')));
        self::assertSame([], self::data($alice->get('/games?role=player&state=trash')));
        self::assertSame(['Chez Bob'], $names(self::data($bob->get('/games?state=trash'))));

        $restored = self::data($alice->post('/games/' . $other['id'] . '/restore'));
        self::assertNull($restored['deleted_at']);
        self::assertNull($restored['archived_at']);
        self::assertEqualsCanonicalizing(['Mine', 'Autre'], $names(self::data($alice->get('/games'))));
        self::assertSame($mine['id'], self::data($alice->get('/games/' . $mine['id']))['id']);
    }
}
