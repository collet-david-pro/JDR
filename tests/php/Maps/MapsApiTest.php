<?php

declare(strict_types=1);

namespace JDR\Tests\Maps;

use JDR\Domain\Maps\MapHousekeeping;
use JDR\Maps\ChunkCodec;

/**
 * Maps CRUD, folders/order, trash, duplication, binary chunks, counts (contract P4b).
 */
final class MapsApiTest extends MapsTestCase
{
    public function testCreateReturnsAFullMapWithDefaults(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm, 'Campagne', ['settings' => ['unit_label' => 'm', 'unit_per_cell' => 1.5, 'default_cell_px' => 64]]);
        $map = $this->newMap($gm, $game['id'], ['name' => '  Crypte  ', 'folder' => ' Acte 1 / / Crypte ']);

        self::assertIsString($map['id']);
        self::assertSame($game['id'], $map['game_id']);
        self::assertSame('Crypte', $map['name']);
        self::assertSame('Acte 1/Crypte', $map['folder']);
        self::assertSame('battle', $map['kind']);
        self::assertSame(['type' => 'square', 'cell_px' => 64, 'width' => 60, 'height' => 40, 'unit_label' => 'm', 'unit_per_cell' => 1.5], $map['grid']);
        self::assertSame('parchment', $map['theme']);
        self::assertSame(['darkness' => 0, 'tint' => '#000000', 'time_of_day' => null, 'weather' => ['type' => 'none', 'intensity' => 0]], $map['ambient']);
        self::assertSame([null], $map['palette']);
        self::assertSame(['ground', 'terrain', 'decor', 'walls', 'props', 'lighting', 'labels', 'gm'], array_column($map['layers'], 'id'));
        self::assertSame(['id' => 'gm', 'kind' => 'objects', 'visible' => true, 'locked' => false, 'opacity' => 1, 'gm_only' => true], $map['layers'][7]);
        self::assertCount(1, $map['floors']);
        self::assertSame(0, $map['floors'][0]['level']);
        self::assertSame('Rez-de-chaussée', $map['floors'][0]['name']);
        self::assertIsString($map['floors'][0]['id']);
        self::assertSame(1, $map['format_version']);
        self::assertSame(0, $map['revision']);
        self::assertSame([], $map['objects']);
        self::assertSame([], $map['notes']);
        self::assertSame([], $map['tokens_placed']);
        self::assertNull($map['thumb_url']);
        self::assertNull($map['deleted_at']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $map['updated_at']);

        self::assertSame(1, self::data($gm->get('/games/' . $game['id']))['counts']['maps']);
        self::assertEquals($map, self::data($gm->get('/maps/' . $map['id'])));
    }

    public function testCreateValidation(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $r = $gm->post('/games/' . $game['id'] . '/maps', ['name' => '', 'kind' => 'dungeon', 'theme' => 'neon', 'height' => 401, 'cell_px' => 8]);
        self::assertFieldErrors($r, ['name' => 'required', 'kind' => 'invalid', 'theme' => 'invalid', 'width' => 'required', 'height' => 'too_large', 'cell_px' => 'too_small']);
        $r = $gm->post('/games/' . $game['id'] . '/maps', ['name' => str_repeat('x', 121), 'width' => 0, 'height' => 1.5, 'folder' => str_repeat('d', 192)]);
        self::assertFieldErrors($r, ['name' => 'too_long', 'width' => 'too_small', 'height' => 'invalid', 'folder' => 'too_long']);
        self::assertSame(201, $gm->post('/games/' . $game['id'] . '/maps', ['name' => 'Max', 'width' => 400, 'height' => 400])->status());
    }

    public function testListOrderPatchAndTrash(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $a = $this->newMap($gm, $game['id'], ['name' => 'A']);
        $b = $this->newMap($gm, $game['id'], ['name' => 'B', 'folder' => 'Acte 1']);
        $c = $this->newMap($gm, $game['id'], ['name' => 'C']);
        self::assertSame([0, 1, 2], array_column(self::data($gm->get('/games/' . $game['id'] . '/maps')), 'sort_order'));

        $patched = self::data($gm->patch('/maps/' . $c['id'], ['sort_order' => -1, 'folder' => 'Acte 2', 'name' => 'C2']));
        self::assertSame(['id', 'game_id', 'name', 'folder', 'sort_order', 'kind', 'grid', 'thumb_url', 'revision', 'updated_at', 'deleted_at'], array_keys($patched));
        self::assertSame(['width' => 60, 'height' => 40], $patched['grid']);
        self::assertSame('Acte 2', $patched['folder']);
        self::assertSame(['C2', 'A', 'B'], array_column(self::data($gm->get('/games/' . $game['id'] . '/maps')), 'name'));
        self::assertNull(self::data($gm->patch('/maps/' . $b['id'], ['folder' => null]))['folder']);
        self::assertFieldErrors($gm->patch('/maps/' . $b['id'], ['sort_order' => 'x', 'name' => ' ']), ['sort_order' => 'invalid', 'name' => 'required']);

        self::assertSame(204, $gm->delete('/maps/' . $a['id'])->status());
        self::assertSame(204, $gm->delete('/maps/' . $a['id'])->status(), 'idempotent');
        self::assertSame(['C2', 'B'], array_column(self::data($gm->get('/games/' . $game['id'] . '/maps')), 'name'));
        $trash = self::data($gm->get('/games/' . $game['id'] . '/maps?state=trash'));
        self::assertSame(['A'], array_column($trash, 'name'));
        self::assertNotNull($trash[0]['deleted_at']);
        self::assertSame(2, self::data($gm->get('/games/' . $game['id']))['counts']['maps']);
        foreach (['GET /maps/' . $a['id'], 'PATCH /maps/' . $a['id'], 'POST /maps/' . $a['id'] . '/duplicate', 'POST /maps/' . $a['id'] . '/ops', 'GET /maps/' . $a['id'] . '/chunks'] as $route) {
            [$method, $path] = explode(' ', $route);
            self::assertSame(404, $gm->request($method, $path, $method === 'GET' ? null : [])->status(), $route);
        }
        self::assertFieldErrors($gm->get('/games/' . $game['id'] . '/maps?state=archived'), ['state' => 'invalid']);

        $restored = self::data($gm->post('/maps/' . $a['id'] . '/restore'));
        self::assertNull($restored['deleted_at']);
        self::assertSame(2, $restored['sort_order'], 'back at the end of the list');
        self::assertSame(['C2', 'B', 'A'], array_column(self::data($gm->get('/games/' . $game['id'] . '/maps')), 'name'));
        self::assertSame(200, $gm->post('/maps/' . $a['id'] . '/restore')->status(), 'restore of a live map is a no-op');
    }

    public function testTrashPurgeAfterTrashDays(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor] = $this->scene();
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 1], [1, 0, 2]])]);
        $keep = $this->newMap($gm, $map['game_id'], ['name' => 'Recent']);
        $gm->delete('/maps/' . $map['id']);
        $gm->delete('/maps/' . $keep['id']);
        $this->ageDeletion('maps', $map['id'], 31);
        $this->ageDeletion('maps', $keep['id'], 29);

        self::assertSame(1, $this->app->container()->get(MapHousekeeping::class)->purgeTrash());
        self::assertSame(0, $this->rows('maps', '`id` = ?', [(int) $map['id']]));
        self::assertSame(1, $this->rows('maps', '`id` = ?', [(int) $keep['id']]));
        foreach (['map_floors', 'map_chunks', 'map_asset_refs'] as $table) {
            self::assertSame(0, $this->rows($table, '`map_id` = ?', [(int) $map['id']]), $table);
        }
    }

    public function testProcessedOpsArePurgedAfter48Hours(): void
    {
        ['gm' => $gm, 'map' => $map] = $this->scene();
        $this->db->execute('UPDATE ' . $this->db->t('processed_ops') . ' SET `created_at` = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 49 HOUR)');
        $fresh = $this->opsOk($gm, $map['id'], [['type' => 'map.meta', 'theme' => 'slate']]);
        self::assertSame(2, $fresh['revision']);
        self::assertSame(2, $this->rows('processed_ops'));
        self::assertSame(1, $this->app->container()->get(MapHousekeeping::class)->purgeProcessedOps());
        self::assertSame(1, $this->rows('processed_ops'), 'the recent lot is kept');
    }

    public function testDuplicateCopiesEverything(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a, 'b' => $b] = $this->scene();
        $this->opsOk($gm, $map['id'], [
            self::tiles($floor, 'ground', [[0, 0, 1], [33, 1, 2, 3, 5], [59, 39, 1]]),
            self::tiles($floor, 'decor', [[5, 5, 2]]),
            ['type' => 'map.meta', 'theme' => 'blueprint', 'ambient' => ['darkness' => 0.5]],
        ]);
        $copy = self::data($gm->post('/maps/' . $map['id'] . '/duplicate'));
        self::assertNotSame($map['id'], $copy['id']);
        self::assertSame('Crypte (copie)', $copy['name']);
        self::assertSame(0, $copy['revision']);
        self::assertSame('blueprint', $copy['theme']);
        self::assertSame(0.5, $copy['ambient']['darkness']);
        self::assertSame([$a['id'], $b['id']], [$copy['palette'][1]['asset_id'], $copy['palette'][2]['asset_id']]);
        self::assertNotSame($floor, $copy['floors'][0]['id']);
        self::assertSame(self::stripFloor($this->storedCells($map['id'])), self::stripFloor($this->storedCells($copy['id'])));
        self::assertSame($this->storedRefs($map['id']), $this->storedRefs($copy['id']));
        self::assertSame([(int) $a['id'] => 2, (int) $b['id'] => 2], $this->storedRefs($copy['id']));

        $named = self::data($gm->post('/maps/' . $map['id'] . '/duplicate', ['name' => 'Autre']));
        self::assertSame('Autre', $named['name']);
        self::assertSame(3, self::data($gm->get('/games/' . $map['game_id']))['counts']['maps']);

        // The copy lives its own life.
        $this->opsOk($gm, $copy['id'], [self::tiles($copy['floors'][0]['id'], 'ground', [[0, 0, 0]])]);
        self::assertSame([(int) $a['id'] => 2, (int) $b['id'] => 2], $this->storedRefs($map['id']));
        self::assertSame([(int) $a['id'] => 1, (int) $b['id'] => 2], $this->storedRefs($copy['id']));
    }

    public function testBinaryChunksFormatAndFilters(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor] = $this->scene();
        $this->opsOk($gm, $map['id'], [
            self::tiles($floor, 'ground', [[0, 0, 1], [40, 2, 2, 7, 9]]),
            self::tiles($floor, 'terrain', [[3, 35, 2]]),
            self::tiles($floor, 'decor', [[59, 39, 1, 255, 15]]),
        ]);

        $r = $gm->get('/maps/' . $map['id'] . '/chunks?floor=' . $floor);
        self::assertSame(200, $r->status());
        self::assertSame('application/octet-stream', $r->header('Content-Type'));
        self::assertSame('2', $r->header('X-Map-Revision'));
        self::assertSame((string) strlen($r->body()), $r->header('Content-Length'));
        $records = self::parseChunks($r->body());
        self::assertSame(
            [[0, 0, 0], [1, 0, 0], [0, 1, 1], [1, 1, 2]],
            array_map(static fn (array $c): array => [$c['cx'], $c['cy'], $c['layer']], $records),
            'ordered by layer, cy, cx',
        );
        $raw = ChunkCodec::decode($records[1]['data'], 'ground', 3);
        self::assertSame([2, 7, 9], ChunkCodec::cellAt($raw, ChunkCodec::offset(8, 2)));
        $raw = ChunkCodec::decode($records[3]['data'], 'decor', 3);
        self::assertSame([1, 255, 15], ChunkCodec::cellAt($raw, ChunkCodec::offset(27, 7)));
        self::assertSame("JC\x01\x02\0\0\0\0", substr($raw, 0, 8));

        $filtered = self::parseChunks($gm->get('/maps/' . $map['id'] . '/chunks?floor=' . $floor . '&layers=ground,decor&cells=1:0,1:1,5:5')->body());
        self::assertSame([[1, 0, 0], [1, 1, 2]], array_map(static fn (array $c): array => [$c['cx'], $c['cy'], $c['layer']], $filtered));
        self::assertCount(4, self::parseChunks($gm->get('/maps/' . $map['id'] . '/chunks')->body()), 'floor defaults to the first one');
        self::assertSame('', $gm->get('/maps/' . $map['id'] . '/chunks?layers=terrain&cells=0:0')->body());

        self::assertFieldErrors($gm->get('/maps/' . $map['id'] . '/chunks?floor=999999'), ['floor' => 'not_found']);
        self::assertFieldErrors($gm->get('/maps/' . $map['id'] . '/chunks?layers=walls'), ['layers' => 'invalid']);
        self::assertFieldErrors($gm->get('/maps/' . $map['id'] . '/chunks?cells=1-2'), ['cells' => 'invalid']);
        self::assertFieldErrors($gm->get('/maps/' . $map['id'] . '/chunks?cells=13:0'), ['cells' => 'invalid']);
    }

    public function testPaletteCarriesSignedUrlsForEditors(): void
    {
        ['gm' => $gm, 'map' => $map, 'a' => $a, 'game' => $game] = $this->scene();
        $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $coGm = $this->client('198.51.100.150');
        $coGm->login('Carol', self::PASSWORD);
        $full = self::data($coGm->get('/maps/' . $map['id']));
        $entry = $full['palette'][1];
        self::assertSame(['asset_id', 'name', 'url', 'thumb_url', 'autotile'], array_keys($entry));
        self::assertSame($a['id'], $entry['asset_id']);
        self::assertSame($a['name'], $entry['name']);
        self::assertNull($entry['autotile']);
        self::assertStringContainsString('t=full', (string) $entry['url']);
        $file = $coGm->get(self::apiPath((string) $entry['url']));
        self::assertSame(200, $file->status());
        self::assertSame(200, $coGm->get(self::apiPath((string) $entry['thumb_url']))->status());

        // Deleted asset (force): the palette keeps the entry without URL.
        self::assertSame(204, $gm->delete('/assets/' . $a['id'] . '?force=1')->status());
        $entry = self::data($gm->get('/maps/' . $map['id']))['palette'][1];
        self::assertNull($entry['url']);
        self::assertNull($entry['thumb_url']);
    }

    public function testAssetUsagesAndDeletionCountMaps(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a, 'b' => $b] = $this->scene();
        // In the palette only: not a usage.
        self::assertSame([], self::data($gm->get('/assets/' . $a['id'] . '/usages'))['maps']);
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 1]])]);
        self::assertSame([['id' => $map['id'], 'name' => 'Crypte']], self::data($gm->get('/assets/' . $a['id'] . '/usages'))['maps']);
        $r = $gm->delete('/assets/' . $a['id']);
        self::assertSame(409, $r->status());
        self::assertSame('asset_in_use', self::errorCode($r));
        self::assertSame([['id' => $map['id'], 'name' => 'Crypte']], $r->payload()['error']['usages']['maps']);
        self::assertSame(204, $gm->delete('/assets/' . $b['id'])->status(), 'b is not painted');

        // Erased: no usage any more.
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 0]])]);
        self::assertSame([], $this->storedRefs($map['id']));
        self::assertSame(204, $gm->delete('/assets/' . $a['id'])->status());
    }

    public function testGameScopeOfAssetsFollowsMapsForEditorsOnly(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $map = $this->newMap($gm, $game['id']);
        $floor = $map['floors'][0]['id'];
        $this->opsOk($gm, $map['id'], [self::paletteAdd(1, $asset['id']), self::tiles($floor, 'ground', [[2, 2, 1]])]);
        $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $this->addMember($gm, $game['id'], 'Bob');
        $coGm = $this->client('198.51.100.150');
        $coGm->login('Carol', self::PASSWORD);
        $player = $this->client('198.51.100.151');
        $player->login('Bob', self::PASSWORD);

        self::assertContains($asset['id'], array_column(self::data($coGm->get('/assets?scope=game:' . $game['id'])), 'id'));
        self::assertSame(200, $coGm->get('/assets/' . $asset['id'])->status());
        self::assertNotContains($asset['id'], array_column(self::data($player->get('/assets?scope=game:' . $game['id'])), 'id'), 'D8');
        self::assertSame(404, $player->get('/assets/' . $asset['id'])->status(), 'D8');
        self::assertSame(403, $player->get('/maps/' . $map['id'])->status());
    }

    public function testDeletingTheGameOrTheAccountKeepsMapsConsistent(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'game' => $game] = $this->scene();
        $this->opsOk($gm, $map['id'], [self::tiles($floor, 'ground', [[0, 0, 1]])]);
        // A co-GM creates a map, then deletes their account: the map goes to the GM.
        $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $coGm = $this->client('198.51.100.150');
        $coGm->login('Carol', self::PASSWORD);
        $carolMap = $this->newMap($coGm, $game['id'], ['name' => 'De Carol']);
        self::assertSame(204, $coGm->request('DELETE', '/me', ['password' => self::PASSWORD])->status());
        self::assertSame($this->userId('Alice'), (int) $this->db->fetchValue('SELECT `owner_user_id` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $carolMap['id']]));
        self::assertSame(200, $gm->get('/maps/' . $carolMap['id'])->status());

        // Game purged: maps, floors, chunks, refs follow (FK CASCADE).
        $gm->delete('/games/' . $game['id']);
        self::assertSame(404, $gm->get('/maps/' . $map['id'])->status(), 'game in the trash');
        $this->ageDeletion('games', $game['id'], 31);
        $this->app->container()->get(\JDR\Domain\Games\GameHousekeeping::class)->purgeTrash();
        foreach (['maps' => '`game_id` = ?', 'map_floors' => '`map_id` = ?', 'map_chunks' => '`map_id` = ?', 'map_asset_refs' => '`map_id` = ?'] as $table => $where) {
            self::assertSame(0, $this->rows($table, $where, [(int) ($table === 'maps' ? $game['id'] : $map['id'])]), $table);
        }
    }

    /**
     * @param array<string, mixed> $cells
     * @return array<string, mixed>
     */
    private static function stripFloor(array $cells): array
    {
        $out = [];
        foreach ($cells as $key => $value) {
            $out[substr($key, (int) strpos($key, '|') + 1)] = $value;
        }

        return $out;
    }
}
