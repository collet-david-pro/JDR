<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Core\Cron;

/**
 * Library: list and filters, edit, tags, categories, favorites, usages, deletion and trash.
 */
final class LibraryApiTest extends AssetsTestCase
{
    public function testListFiltersAndPagination(): void
    {
        $alice = $this->userClient('Alice');
        $wall = $this->uploadOk($alice, 'valid_png_opaque.png', ['kind' => 'tile', 'name' => 'Mur 100%_pierre']);
        $hero = $this->uploadOk($alice, 'valid_gif_animated.gif', ['kind' => 'token', 'name' => 'Héros']);
        $tree = $this->uploadOk($alice, 'valid_webp_lossy.webp', ['kind' => 'object', 'name' => 'Arbre']);
        $bob = $this->userClient('Bob', 'user', '203.0.113.11');
        $this->uploadOk($bob, 'valid_gif_static.gif', ['name' => 'Secret de Bob']);
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        $general = $this->uploadOk($admin, 'valid_jpeg_exif_orientation6.jpg', ['scope' => 'general', 'name' => 'Sol général']);

        $ids = static fn ($r): array => array_column($r->payload()['data'], 'id');
        self::assertSame([$tree['id'], $hero['id'], $wall['id']], $ids($alice->get('/assets')));
        self::assertSame([$tree['id'], $hero['id'], $wall['id']], $ids($alice->get('/assets?scope=mine')));
        self::assertSame([$general['id']], $ids($alice->get('/assets?scope=general')));
        self::assertSame([$hero['id']], $ids($alice->get('/assets?kind=token')));
        self::assertSame([$wall['id']], $ids($alice->get('/assets?q=' . rawurlencode('100%_'))));
        self::assertSame([$wall['id']], $ids($alice->get('/assets?q=' . rawurlencode('%'))));
        self::assertSame([$wall['id']], $ids($alice->get('/assets?q=_')));
        self::assertSame([$hero['id']], $ids($alice->get('/assets?q=h%C3%A9')));
        self::assertSame([], $ids($alice->get('/assets?q=Secret')));
        self::assertSame([], $ids($admin->get('/assets?q=Secret')));

        $page1 = $alice->get('/assets?limit=2');
        self::assertSame([$tree['id'], $hero['id']], $ids($page1));
        $cursor = $page1->payload()['meta']['next_cursor'];
        self::assertSame($hero['id'], $cursor);
        $page2 = $alice->get('/assets?limit=2&cursor=' . $cursor);
        self::assertSame([$wall['id']], $ids($page2));
        self::assertNull($page2->payload()['meta']['next_cursor']);

        foreach (['/assets?scope=game:1', '/assets?scope=all', '/assets?kind=dragon', '/assets?category=abc'] as $bad) {
            self::assertSame(422, $alice->get($bad)->status(), $bad);
        }
    }

    public function testEditTagsCategoriesAndFavorites(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $other = $this->uploadOk($alice, 'valid_gif_static.gif');

        $category = $alice->post('/asset-categories', ['name' => 'Donjon']);
        self::assertSame(201, $category->status(), $category->body());
        $catId = $category->payload()['data']['id'];

        $patched = $alice->patch('/assets/' . $asset['id'], [
            'name' => 'Dalle', 'kind' => 'tile', 'category_id' => $catId, 'tags' => ['pierre', ' Sol  gris ', 'PIERRE'],
        ]);
        self::assertSame(200, $patched->status(), $patched->body());
        $data = $patched->payload()['data'];
        self::assertSame(['Dalle', 'tile', $catId], [$data['name'], $data['kind'], $data['category_id']]);
        self::assertSame(['pierre', 'Sol gris'], array_column($data['tags'], 'name'));
        self::assertSame(2, $this->rows('asset_tags'));

        $tags = self::data($alice->get('/asset-tags'));
        self::assertSame(['pierre', 'Sol gris'], array_column($tags, 'name'));
        self::assertSame('personal', $tags[0]['scope']);

        self::assertSame([$asset['id']], array_column(self::data($alice->get('/assets?tag=pierre')), 'id'));
        self::assertSame([$asset['id']], array_column(self::data($alice->get('/assets?tag=' . $tags[1]['id'])), 'id'));
        self::assertSame([], self::data($alice->get('/assets?tag=inconnu')));
        self::assertSame([$asset['id']], array_column(self::data($alice->get('/assets?category=' . $catId)), 'id'));

        self::assertSame(204, $alice->put('/assets/' . $other['id'] . '/favorite', null)->status());
        self::assertSame(204, $alice->put('/assets/' . $other['id'] . '/favorite', null)->status());
        $favorites = self::data($alice->get('/assets?favorites=1'));
        self::assertSame([$other['id']], array_column($favorites, 'id'));
        self::assertTrue($favorites[0]['favorite']);
        self::assertSame(204, $alice->delete('/assets/' . $other['id'] . '/favorite')->status());
        self::assertSame([], self::data($alice->get('/assets?favorites=1')));

        // Clearing the category and the tags.
        $cleared = self::data($alice->patch('/assets/' . $asset['id'], ['category_id' => null, 'tags' => []]));
        self::assertNull($cleared['category_id']);
        self::assertSame([], $cleared['tags']);

        $invalid = $alice->patch('/assets/' . $asset['id'], ['name' => '', 'kind' => 'x', 'tags' => 'pierre', 'category_id' => 'abc']);
        self::assertSame(['name' => 'required', 'kind' => 'invalid', 'category_id' => 'invalid', 'tags' => 'invalid'], $invalid->payload()['error']['fields']);

        // A general category may hold personal assets; another user's category may not.
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        $generalCat = self::data($admin->post('/asset-categories', ['name' => 'Commun', 'scope' => 'general']));
        self::assertSame(200, $alice->patch('/assets/' . $asset['id'], ['category_id' => $generalCat['id']])->status());
        $adminCat = self::data($admin->post('/asset-categories', ['name' => 'Perso admin']));
        self::assertSame(['category_id' => 'invalid'], $alice->patch('/assets/' . $asset['id'], ['category_id' => $adminCat['id']])->payload()['error']['fields']);
    }

    public function testCategoriesTree(): void
    {
        $alice = $this->userClient('Alice');
        $root = self::data($alice->post('/asset-categories', ['name' => 'Racine']));
        $child = self::data($alice->post('/asset-categories', ['name' => 'Enfant', 'parent_id' => $root['id']]));
        self::assertSame($root['id'], $child['parent_id']);
        self::assertSame('personal', $child['scope']);
        $grandChild = self::data($alice->post('/asset-categories', ['name' => 'Petit', 'parent_id' => $child['id']]));

        // Cycle refused.
        $cycle = $alice->patch('/asset-categories/' . $root['id'], ['parent_id' => $grandChild['id']]);
        self::assertSame(['parent_id' => 'invalid'], $cycle->payload()['error']['fields']);
        self::assertSame(['parent_id' => 'invalid'], $alice->patch('/asset-categories/' . $root['id'], ['parent_id' => $root['id']])->payload()['error']['fields']);

        $moved = self::data($alice->patch('/asset-categories/' . $grandChild['id'], ['parent_id' => null, 'name' => 'Libre', 'sort_order' => 5]));
        self::assertSame([null, 'Libre', 5], [$moved['parent_id'], $moved['name'], $moved['sort_order']]);

        // General categories (admin) are listed with the personal ones; users cannot change them.
        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        $general = $admin->post('/asset-categories', ['name' => 'Sols', 'scope' => 'general']);
        self::assertSame(201, $general->status());
        $generalId = $general->payload()['data']['id'];
        self::assertSame(403, $alice->post('/asset-categories', ['name' => 'X', 'scope' => 'general'])->status());
        self::assertSame(403, $alice->patch('/asset-categories/' . $generalId, ['name' => 'X'])->status());
        self::assertSame(403, $alice->delete('/asset-categories/' . $generalId)->status());
        self::assertSame(['parent_id' => 'invalid'], $alice->post('/asset-categories', ['name' => 'Sous', 'parent_id' => $generalId])->payload()['error']['fields']);
        $list = self::data($alice->get('/asset-categories'));
        self::assertSame(['general', 'personal', 'personal', 'personal'], array_column($list, 'scope'));
        self::assertSame(['Sols'], array_column(self::data($this->userClient('Bob', 'user', '203.0.113.11')->get('/asset-categories')), 'name'));

        // Deleting a parent moves the children to the root.
        self::assertSame(204, $alice->delete('/asset-categories/' . $root['id'])->status());
        $children = array_values(array_filter(self::data($alice->get('/asset-categories')), static fn ($c) => $c['id'] === $child['id']));
        self::assertNull($children[0]['parent_id']);
        self::assertSame(404, $admin->delete('/asset-categories/' . $child['id'])->status());
    }

    public function testTags(): void
    {
        $alice = $this->userClient('Alice');
        $tag = $alice->post('/asset-tags', ['name' => 'Forêt']);
        self::assertSame(201, $tag->status());
        self::assertSame(['name' => 'taken'], $alice->post('/asset-tags', ['name' => 'forêt'])->payload()['error']['fields']);
        self::assertSame(403, $alice->post('/asset-tags', ['name' => 'Général', 'scope' => 'general'])->status());

        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        self::assertSame(201, $admin->post('/asset-tags', ['name' => 'Forêt', 'scope' => 'general'])->status());
        self::assertSame(['name' => 'taken'], $admin->post('/asset-tags', ['name' => 'FORÊT', 'scope' => 'general'])->payload()['error']['fields']);
        $list = self::data($alice->get('/asset-tags'));
        self::assertSame([['Forêt', 'general'], ['Forêt', 'personal']], array_map(static fn ($t) => [$t['name'], $t['scope']], $list));

        $generalId = $list[0]['id'];
        self::assertSame(403, $alice->delete('/asset-tags/' . $generalId)->status());
        self::assertSame(404, $admin->delete('/asset-tags/' . $list[1]['id'])->status());
        self::assertSame(204, $alice->delete('/asset-tags/' . $list[1]['id'])->status());
        self::assertSame(204, $admin->delete('/asset-tags/' . $generalId)->status());
        self::assertSame(0, $this->rows('asset_tags'));
    }

    public function testDeletionWithUsagesAndTrash(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $id = (int) $asset['id'];
        $aliceId = $this->userId('Alice');
        $bobId = $this->createUser('Bob');
        $used = $this->usedBytes('Alice');

        self::assertSame(['maps' => [], 'tokens' => []], self::data($alice->get('/assets/' . $id . '/usages')));

        $mapId = $this->insertMap($aliceId, 'Crypte');
        $bobMap = $this->insertMap($bobId, 'Carte de Bob');
        $gameId = $this->insertGame($aliceId);
        $this->db->execute('INSERT INTO ' . $this->db->t('map_asset_refs') . ' (`map_id`, `asset_id`, `ref_count`) VALUES (?, ?, 3), (?, ?, 1)', [$mapId, $id, $bobMap, $id]);
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('tokens') . " (`game_id`, `name`, `asset_id`, `kind`, `vision`, `created_at`, `updated_at`) VALUES (?, 'Gobelin', ?, 'npc', '{}', UTC_TIMESTAMP(), UTC_TIMESTAMP())",
            [$gameId, $id],
        );

        $usages = self::data($alice->get('/assets/' . $id . '/usages'));
        self::assertSame([['id' => (string) $mapId, 'name' => 'Crypte'], ['id' => (string) $bobMap, 'name' => null]], $usages['maps']);
        self::assertSame('Gobelin', $usages['tokens'][0]['name']);

        $refused = $alice->delete('/assets/' . $id);
        self::assertSame(409, $refused->status());
        $error = $refused->payload()['error'];
        self::assertSame('asset_in_use', $error['code']);
        self::assertSame($usages, $error['usages']);
        self::assertSame($used, $this->usedBytes('Alice'));

        self::assertSame(204, $alice->delete('/assets/' . $id . '?force=1')->status());
        self::assertSame(0, $this->usedBytes('Alice'));
        self::assertSame(404, $alice->get('/assets/' . $id)->status());
        self::assertSame([], self::data($alice->get('/assets')));
        self::assertSame(404, $alice->delete('/assets/' . $id)->status());
        $uuid = $asset['uuid'];
        $file = self::storage() . '/assets/' . substr($uuid, 0, 2) . '/' . substr($uuid, 2, 2) . '/' . $uuid . '.png';
        self::assertFileExists($file);
        self::assertTrue($this->integrity()['ok']);

        // Re-uploading the same image after a deletion creates a new asset.
        $again = $this->uploadOk($alice, 'valid_png_opaque.png');
        self::assertNotSame($asset['id'], $again['id']);

        // Trash purge (cron): after trash_days, row and files are gone.
        $this->db->execute('UPDATE ' . $this->db->t('assets') . ' SET `deleted_at` = UTC_TIMESTAMP() - INTERVAL 31 DAY WHERE `id` = ?', [$id]);
        $tasks = $this->app->container()->get(Cron::class)->runTasks(10.0);
        self::assertContains('assets_trash', $tasks);
        self::assertFileDoesNotExist($file);
        self::assertSame(0, $this->rows('assets', '`id` = ?', [$id]));
        self::assertSame(1, $this->rows('assets'));
        self::assertNull($this->db->fetchValue('SELECT `asset_id` FROM ' . $this->db->t('tokens')));
        self::assertTrue($this->integrity()['ok']);
    }

    public function testTmpPurge(): void
    {
        $old = self::storage() . '/tmp/oldfile';
        $oldDir = self::storage() . '/tmp/olddir.work';
        $fresh = self::storage() . '/tmp/fresh';
        @mkdir($oldDir, 0777, true);
        file_put_contents($oldDir . '/x', 'x');
        file_put_contents($old, 'x');
        file_put_contents($fresh, 'x');
        touch($old, time() - 7200);
        touch($oldDir, time() - 7200);
        @mkdir(self::storage() . '/jobs', 0777, true);
        $oldZip = self::storage() . '/jobs/' . str_repeat('a', 24) . '.zip';
        file_put_contents($oldZip, 'x');
        touch($oldZip, time() - 2 * 86400);

        $this->app->container()->get(Cron::class)->runTasks(10.0);
        self::assertFileDoesNotExist($old);
        self::assertDirectoryDoesNotExist($oldDir);
        self::assertFileExists($fresh);
        self::assertFileDoesNotExist($oldZip);
    }

    public function testAccountDeletionTrashesPersonalAssets(): void
    {
        $alice = $this->userClient('Alice');
        $this->uploadOk($alice, 'valid_png_opaque.png');
        $export = $alice->get('/me/export');
        self::assertCount(1, $export->payload()['assets']);
        self::assertSame(204, $alice->request('DELETE', '/me', ['password' => self::PASSWORD])->status());
        self::assertSame(1, $this->rows('assets', '`deleted_at` IS NOT NULL'));
    }

    private function insertMap(int $ownerId, string $name): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('maps') . " (`owner_user_id`, `name`, `width_cells`, `height_cells`, `ambient`, `palette`, `layers`, `format_version`, `created_at`, `updated_at`) VALUES (?, ?, 10, 10, '{}', '[]', '[]', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())",
            [$ownerId, $name],
        );

        return (int) $this->db->lastInsertId();
    }

    private function insertGame(int $gmId): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('games') . " (`gm_user_id`, `name`, `settings`, `created_at`, `updated_at`) VALUES (?, 'Partie', '{}', UTC_TIMESTAMP(), UTC_TIMESTAMP())",
            [$gmId],
        );

        return (int) $this->db->lastInsertId();
    }
}
