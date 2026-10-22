<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP4c;

use JDR\Domain\Maps\Versions\MapVersionService;

/**
 * Map versions (contract P4c, projet.md 11.4): manual, auto every 5 min of editing (frozen
 * clocks), restore in a new revision with pre_restore and idempotence, retention.
 */
final class MapVersionsTest extends MapsP4cTestCase
{
    public function testManualVersionsAreListedMostRecentFirst(): void
    {
        $s = $this->scene();
        $response = $s['gm']->post('/maps/' . $s['map']['id'] . '/versions', ['label' => '  Avant le combat  ']);
        self::assertSame(201, $response->status(), $response->body());
        $v1 = self::data($response);
        self::assertSame(['id', 'map_id', 'revision', 'kind', 'label', 'size_bytes', 'created_by', 'created_at'], array_keys($v1));
        self::assertSame('manual', $v1['kind']);
        self::assertSame('Avant le combat', $v1['label']);
        self::assertSame($s['map']['id'], $v1['map_id']);
        self::assertSame(1, $v1['revision']);
        self::assertSame(['id' => (string) $this->userId('Alice'), 'username' => 'Alice'], $v1['created_by']);
        self::assertGreaterThan(0, $v1['size_bytes']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $v1['created_at']);

        $this->opsOk($s['gm'], $s['map']['id'], [self::tiles($s['floor'], 'ground', [[0, 0, 1]])]);
        $v2 = self::data($s['gm']->post('/maps/' . $s['map']['id'] . '/versions', []));
        self::assertNull($v2['label']);
        self::assertSame(2, $v2['revision']);
        self::assertSame([$v2['id'], $v1['id']], array_column(self::data($s['gm']->get('/maps/' . $s['map']['id'] . '/versions')), 'id'));

        $this->assertFieldErrors($s['gm']->post('/maps/' . $s['map']['id'] . '/versions', ['label' => str_repeat('x', 121)]), ['label' => 'too_long']);
        $this->assertFieldErrors($s['gm']->post('/maps/' . $s['map']['id'] . '/versions', ['label' => ['x']]), ['label' => 'invalid']);

        // The snapshot is the internal document, gzipped.
        $blob = (string) $this->db->fetchValue('SELECT `snapshot` FROM ' . $this->db->t('map_versions') . ' WHERE `id` = ?', [(int) $v2['id']]);
        $doc = json_decode((string) gzdecode($blob), true);
        self::assertSame('jdr-map', $doc['format']);
        self::assertSame($s['a']['id'], (string) $doc['palette'][1]['asset_id']);
        self::assertSame(['f1|ground|0,0' => [1, 0, 0]], self::docCells($doc));
    }

    public function testAutoSnapshotAfterFiveMinutesOfEditing(): void
    {
        $s = $this->scene();
        $mapId = $s['map']['id'];
        $created = (int) strtotime((string) $this->db->fetchValue('SELECT `created_at` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $mapId]) . ' UTC');
        $paint = function (int $x) use ($s, $mapId): void {
            $this->opsOk($s['gm'], $mapId, [self::tiles($s['floor'], 'ground', [[$x, 0, 1]])]);
        };

        $this->freezeAt($created + 240, $s['gm']);
        $paint(1);
        self::assertSame(0, $this->rows('map_versions'));

        $this->freezeAt($created + 301, $s['gm']);
        $paint(2);
        $versions = self::data($s['gm']->get('/maps/' . $mapId . '/versions'));
        self::assertCount(1, $versions);
        self::assertSame('auto', $versions[0]['kind']);
        self::assertSame($this->revision($mapId), $versions[0]['revision']);
        // The snapshot holds the lot that triggered it.
        $doc = json_decode((string) gzdecode((string) $this->db->fetchValue('SELECT `snapshot` FROM ' . $this->db->t('map_versions'))), true);
        self::assertArrayHasKey('f1|ground|2,0', self::docCells($doc));

        $this->freezeAt($created + 500, $s['gm']);
        $paint(3);
        self::assertSame(1, $this->rows('map_versions'), 'less than 5 min since the last auto snapshot');

        $this->freezeAt($created + 620, $s['gm']);
        $this->sendOps($s['gm'], $mapId, []);
        self::assertSame(1, $this->rows('map_versions'), 'an empty lot changes nothing');
        $paint(4);
        self::assertSame(2, $this->rows('map_versions', "`kind` = 'auto'"));

        // Any applied lot is a new revision (even when a cell is rewritten with its own value).
        $this->freezeAt($created + 3600, $s['gm']);
        $this->sendOps($s['gm'], $mapId, [self::tiles($s['floor'], 'ground', [[4, 0, 1]])]);
        self::assertSame(3, $this->rows('map_versions', "`kind` = 'auto'"), 'a replayed identical cell is still a new revision');
    }

    public function testRestoreCreatesANewRevisionAfterAPreRestoreSnapshot(): void
    {
        $s = $this->scene();
        $mapId = $s['map']['id'];
        $this->opsOk($s['gm'], $mapId, [
            self::tiles($s['floor'], 'ground', [[0, 0, 1], [1, 0, 1], [2, 0, 2]]),
            ['type' => 'map.meta', 'name' => 'Crypte v1', 'theme' => 'dark'],
        ]);
        $cellsV1 = $this->storedCells($mapId);
        $refsV1 = $this->storedRefs($mapId);
        $version = self::data($s['gm']->post('/maps/' . $mapId . '/versions', ['label' => 'v1']));

        $this->opsOk($s['gm'], $mapId, [
            self::tiles($s['floor'], 'ground', [[0, 0, 0], [5, 5, 2], [33, 33, 2]]),
            self::tiles($s['floor'], 'decor', [[7, 7, 1]]),
            ['type' => 'map.meta', 'name' => 'Crypte v2', 'theme' => 'light', 'grid' => ['width' => 50]],
        ]);
        $revisionBefore = $this->revision($mapId);
        $cellsV2 = $this->storedCells($mapId);

        $response = $s['gm']->post('/maps/' . $mapId . '/versions/' . $version['id'] . '/restore', ['client_op_id' => 'restore-1']);
        self::assertSame(200, $response->status(), $response->body());
        $result = self::data($response);
        self::assertSame($revisionBefore + 1, $result['revision']);
        self::assertSame($result['revision'], $result['map']['revision']);
        self::assertSame('Crypte v1', $result['map']['name']);
        self::assertSame('dark', $result['map']['theme']);
        self::assertSame(60, $result['map']['grid']['width']);
        self::assertSame($s['floor'], $result['map']['floors'][0]['id'], 'the floor keeps its id');
        self::assertSame(array_values($cellsV1), array_values($this->storedCells($mapId)));
        self::assertSame(array_keys($cellsV1), array_keys($this->storedCells($mapId)));
        self::assertSame($refsV1, $this->storedRefs($mapId));
        self::assertSame($this->recountRefs($mapId), $this->storedRefs($mapId));

        $versions = self::data($s['gm']->get('/maps/' . $mapId . '/versions'));
        self::assertSame(['pre_restore', 'manual'], array_column($versions, 'kind'));
        self::assertSame($revisionBefore, $versions[0]['revision']);
        // The pre_restore snapshot can be restored back: the history is never lost.
        $back = self::data($s['gm']->post('/maps/' . $mapId . '/versions/' . $versions[0]['id'] . '/restore', []));
        self::assertSame($revisionBefore + 2, $back['revision']);
        self::assertSame('Crypte v2', $back['map']['name']);
        self::assertSame(array_values($cellsV2), array_values($this->storedCells($mapId)));
        self::assertSame(3, $this->rows('map_versions'));

        // Same client_op_id: same answer, nothing re-executed.
        $replay = self::data($s['gm']->post('/maps/' . $mapId . '/versions/' . $version['id'] . '/restore', ['client_op_id' => 'restore-1']));
        self::assertSame($result['revision'], $replay['revision']);
        self::assertSame($revisionBefore + 2, $this->revision($mapId));
        self::assertSame(3, $this->rows('map_versions'));
        // Header form, and an id reused for something else.
        $viaHeader = $s['gm']->request('POST', '/maps/' . $mapId . '/versions/' . $version['id'] . '/restore', [], ['X-Client-Op-Id' => 'restore-1']);
        self::assertSame($result['revision'], self::data($viaHeader)['revision']);
        $this->assertFieldErrors(
            $s['gm']->post('/maps/' . $mapId . '/versions/' . $versions[0]['id'] . '/restore', ['client_op_id' => 'restore-1']),
            ['client_op_id' => 'already_used'],
        );
        $this->assertFieldErrors($this->sendOps($s['gm'], $mapId, [], null, 'restore-1'), ['client_op_id' => 'already_used']);

        // Ops go on from the restored revision.
        $this->opsOk($s['gm'], $mapId, [self::tiles($s['floor'], 'ground', [[9, 9, 1]])]);
        self::assertSame(404, $s['gm']->post('/maps/' . $mapId . '/versions/999999/restore', [])->status());
    }

    public function testRestoreWithAPurgedAssetKeepsItsSlotEmpty(): void
    {
        $s = $this->scene();
        $mapId = $s['map']['id'];
        $this->opsOk($s['gm'], $mapId, [self::tiles($s['floor'], 'ground', [[0, 0, 1], [1, 0, 2]])]);
        $version = self::data($s['gm']->post('/maps/' . $mapId . '/versions', []));
        $this->opsOk($s['gm'], $mapId, [self::tiles($s['floor'], 'ground', [[0, 0, 0], [1, 0, 0]])]);
        $this->db->execute('DELETE FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $s['b']['id']]);

        $result = self::data($s['gm']->post('/maps/' . $mapId . '/versions/' . $version['id'] . '/restore', []));
        self::assertSame($s['a']['id'], $result['map']['palette'][1]['asset_id']);
        self::assertNull($result['map']['palette'][2]);
        self::assertSame([(int) $s['a']['id'] => 1], $this->storedRefs($mapId));
        self::assertCount(2, $this->storedCells($mapId), 'cells of the empty slot are kept');
        // The slot can be filled again.
        $this->opsOk($s['gm'], $mapId, [self::paletteAdd(2, $s['a']['id'])]);
    }

    public function testRetentionKeepsManualRecentAndTheLastAutoVersions(): void
    {
        $s = $this->scene();
        $mapId = (int) $s['map']['id'];
        $t = $this->db->t('map_versions');
        $insert = function (string $kind, int $daysAgo, int $i) use ($t, $mapId): void {
            $this->db->execute(
                'INSERT INTO ' . $t . " (`map_id`, `revision`, `kind`, `label`, `snapshot`, `size_bytes`, `created_by`, `created_at`) "
                . 'VALUES (?, ?, ?, NULL, ?, 1, NULL, DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE))',
                [$mapId, $i, $kind, 'x', $daysAgo * 1440 + $i],
            );
        };
        for ($i = 0; $i < 25; $i++) {
            $insert('auto', 1, $i);           // recent autos
            $insert('auto', 20, 100 + $i);    // old autos
        }
        $insert('manual', 100, 500);
        $insert('pre_restore', 30, 501);
        $insert('pre_restore', 2, 502);
        $other = (int) $this->newMap($s['gm'], $s['game']['id'])['id'];
        for ($i = 0; $i < 3; $i++) {
            $this->db->execute(
                'INSERT INTO ' . $t . " (`map_id`, `revision`, `kind`, `snapshot`, `size_bytes`, `created_at`) VALUES (?, 0, 'auto', 'x', 1, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY))",
                [$other],
            );
        }

        $deleted = $this->app->container()->get(MapVersionService::class)->trim(30);
        self::assertSame(20 + 1, $deleted);
        self::assertSame(25 + 5, $this->rows('map_versions', "`map_id` = ? AND `kind` = 'auto'", [$mapId]));
        self::assertSame(1, $this->rows('map_versions', "`kind` = 'manual'"));
        self::assertSame(1, $this->rows('map_versions', "`map_id` = ? AND `kind` = 'pre_restore'", [$mapId]));
        self::assertSame(3, $this->rows('map_versions', '`map_id` = ?', [$other]), 'fewer than 30 autos: all kept');
        self::assertSame(0, $this->app->container()->get(MapVersionService::class)->trim(30), 'idempotent');

        // Through the cron, with the setting.
        $this->changeSetting('versions_retention', 2);
        $this->app->container()->get(\JDR\Core\Cron::class)->runTasks(5.0);
        self::assertSame(25, $this->rows('map_versions', "`map_id` = ? AND `kind` = 'auto'", [$mapId]), 'recent ones are kept');
        self::assertSame(2, $this->rows('map_versions', '`map_id` = ?', [$other]));
    }

    public function testVersionsAreForEditorsOnly(): void
    {
        $s = $this->scene();
        $version = self::data($s['gm']->post('/maps/' . $s['map']['id'] . '/versions', []));
        $this->addMember($s['gm'], $s['game']['id'], 'Bob');
        $bob = $this->client('198.51.100.241');
        $bob->login('Bob', self::PASSWORD);
        $this->addMember($s['gm'], $s['game']['id'], 'Carol', 'co_gm');
        $carol = $this->client('198.51.100.242');
        $carol->login('Carol', self::PASSWORD);
        $dave = $this->user('Dave');
        $path = '/maps/' . $s['map']['id'] . '/versions';

        self::assertSame(403, $bob->get($path)->status());
        self::assertSame(403, $bob->post($path . '/' . $version['id'] . '/restore', [])->status());
        self::assertSame(404, $dave->get($path)->status());
        self::assertSame(200, $carol->get($path)->status());
        self::assertSame(201, $carol->post($path, [])->status());
        self::assertSame(200, $carol->post($path . '/' . $version['id'] . '/restore', [])->status());
        // A version of another map is not reachable through this map.
        $other = $this->newMap($s['gm'], $s['game']['id']);
        self::assertSame(404, $s['gm']->post('/maps/' . $other['id'] . '/versions/' . $version['id'] . '/restore', [])->status());
        // Map in the trash: 404.
        self::assertSame(204, $s['gm']->delete('/maps/' . $s['map']['id'])->status());
        self::assertSame(404, $s['gm']->get($path)->status());
    }
}
