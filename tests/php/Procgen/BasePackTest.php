<?php

declare(strict_types=1);

namespace JDR\Tests\Procgen;

use JDR\Domain\Procgen\BasePackManifest;
use JDR\Tests\Assets\AssetsTestCase;
use JDR\Tests\Api\ApiClient;

/**
 * Base pack of the procedural generators: lazy installation in the general library and
 * GET /procgen/pack. A reduced manifest (real fixtures) stands in for the shipped one.
 */
final class BasePackTest extends AssetsTestCase
{
    private const FILES = [
        'floor.stone' => ['valid_png_opaque.png', 'Pierre'],
        'floor.wood' => ['valid_png_transparent.png', 'Parquet'],
        'decor.tree' => ['valid_webp_lossless.webp', 'Arbre'],
    ];

    private string $dir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = self::$root . '/base-pack-test';
        self::emptyDir($this->dir);
        @mkdir($this->dir, 0775, true);
        $this->db->execute('INSERT INTO ' . $this->db->t('asset_categories') . ' (owner_user_id, parent_id, name, sort_order) VALUES (NULL, NULL, ?, 10)', ['Sols']);
    }

    /**
     * @param list<string> $keys
     */
    private function manifest(int $version, array $keys): void
    {
        $entries = [];
        foreach ($keys as $key) {
            [$fixture, $name] = self::FILES[$key];
            copy(self::fixture($fixture), $this->dir . '/' . $key . '.png');
            $entries[] = [
                'key' => $key,
                'file' => $key . '.png',
                'name' => $name,
                'category' => str_starts_with($key, 'floor.') ? 'Sols' : 'Nature',
                'kind' => 'tile',
                'tags' => ['Test Pack'],
                'rgba_sha256' => str_repeat('a', 64),
            ];
        }
        file_put_contents($this->dir . '/pack.json', json_encode(['version' => $version, 'entries' => $entries]));
        // A fresh application = a new request (no cached service, no cached setting).
        $this->app = $this->makeApp();
        $this->app->container()->instance(BasePackManifest::class, new BasePackManifest(null, $this->dir . '/pack.json'));
    }

    private function packClient(): ApiClient
    {
        return $this->userClient('Alice');
    }

    public function testRequiresASession(): void
    {
        $this->manifest(1, ['floor.stone']);
        self::assertSame(401, $this->client()->get('/procgen/pack')->status());
    }

    public function testInstallsIntoTheGeneralLibraryWithoutQuota(): void
    {
        $this->manifest(1, array_keys(self::FILES));
        $alice = $this->packClient();
        $response = $alice->get('/procgen/pack');
        self::assertSame(200, $response->status(), $response->body());
        $data = self::data($response);
        self::assertSame(1, $data['version']);
        self::assertSame(['decor.tree', 'floor.stone', 'floor.wood'], array_keys($data['assets']));
        $stone = $data['assets']['floor.stone'];
        self::assertSame(['asset_id', 'name', 'url'], $this->sorted(array_keys($stone)));
        self::assertIsString($stone['asset_id']);
        self::assertSame('Pierre', $stone['name']);
        self::assertMatchesRegularExpression('#^/api/v1/files/[0-9a-f-]{36}\?t=full&e=\d+&s=[A-Za-z0-9_-]+$#', $stone['url']);
        self::assertSame(200, $this->client('203.0.113.50')->get(self::apiPath($stone['url']))->status());

        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $stone['asset_id']]);
        self::assertNotNull($row);
        self::assertNull($row['owner_user_id']);
        self::assertSame('system', $row['source']);
        $sols = (int) $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('asset_categories') . ' WHERE `name` = ?', ['Sols']);
        self::assertSame($sols, (int) $row['category_id']);
        $tree = $this->db->fetchOne('SELECT `category_id` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $data['assets']['decor.tree']['asset_id']]);
        self::assertNull($tree['category_id'], 'absent category => null');
        self::assertSame(0, $this->usedBytes('Alice'));
        self::assertSame(3, $this->rows('assets', '`owner_user_id` IS NULL'));
        self::assertSame([], self::tmpLeftovers());
    }

    public function testReplayDoesNotDuplicateAndVersionBumpImportsNewKeys(): void
    {
        $this->manifest(1, ['floor.stone']);
        $alice = $this->packClient();
        $first = self::data($alice->get('/procgen/pack'));
        self::assertSame($first, self::data($alice->get('/procgen/pack')));
        self::assertSame(1, $this->rows('assets'));

        // Same version, forgotten setting: the importer finds the duplicates again.
        $this->db->execute('DELETE FROM ' . $this->db->t('settings') . ' WHERE `key` = ?', ['base_pack']);
        $this->app->container()->get(\JDR\Domain\Settings\Settings::class)->refresh();
        $again = self::data($alice->get('/procgen/pack'));
        self::assertSame($first['assets']['floor.stone']['asset_id'], $again['assets']['floor.stone']['asset_id']);
        self::assertSame(1, $this->rows('assets'));

        $this->manifest(2, ['floor.stone', 'floor.wood']);
        $alice = $this->client();
        $alice->login('Alice', self::PASSWORD);
        $second = self::data($alice->get('/procgen/pack'));
        self::assertSame(2, $second['version']);
        self::assertSame(['floor.stone', 'floor.wood'], array_keys($second['assets']));
        self::assertSame($first['assets']['floor.stone']['asset_id'], $second['assets']['floor.stone']['asset_id']);
        self::assertSame(2, $this->rows('assets'));
    }

    public function testDeletedAssetsAreOmitted(): void
    {
        $this->manifest(1, ['floor.stone', 'floor.wood']);
        $alice = $this->packClient();
        $data = self::data($alice->get('/procgen/pack'));
        $this->db->execute('UPDATE ' . $this->db->t('assets') . ' SET `deleted_at` = UTC_TIMESTAMP() WHERE `id` = ?', [(int) $data['assets']['floor.wood']['asset_id']]);
        $after = self::data($alice->get('/procgen/pack'));
        self::assertSame(['floor.stone'], array_keys($after['assets']));
    }

    public function testAnEntryThatFailsIsSkippedAndTheOthersContinue(): void
    {
        $this->manifest(1, ['floor.stone', 'floor.wood']);
        file_put_contents($this->dir . '/floor.stone.png', 'not an image');
        $alice = $this->packClient();
        $data = self::data($alice->get('/procgen/pack'));
        self::assertSame(['floor.wood'], array_keys($data['assets']));
    }

    public function testTheShippedManifestIsValid(): void
    {
        $manifest = new BasePackManifest(new \JDR\Domain\Support\AppPaths(self::projectRoot(), self::$root . '/storage', self::projectRoot()));
        self::assertSame(1, $manifest->version());
        self::assertCount(39, $manifest->entries());
        foreach ($manifest->entries() as $entry) {
            self::assertFileExists($manifest->directory() . '/' . $entry['file']);
            self::assertSame("\x89PNG", substr((string) file_get_contents($manifest->directory() . '/' . $entry['file'], false, null, 0, 4), 0, 4));
        }
    }

    public function testManifestValidationRejectsBadEntries(): void
    {
        $file = $this->dir . '/bad.json';
        foreach ([
            '{"version": 1, "entries": [{"key": "x"}]}',
            '{"version": 0, "entries": []}',
            '{"version": 1, "entries": [{"key": "floor.a", "file": "../a.png", "name": "A", "category": "Sols", "kind": "tile", "tags": [], "rgba_sha256": "' . str_repeat('a', 64) . '"}]}',
            'not json',
        ] as $json) {
            file_put_contents($file, $json);
            try {
                (new BasePackManifest(null, $file))->entries();
                self::fail('Accepted: ' . $json);
            } catch (\RuntimeException) {
                self::assertTrue(true);
            }
        }
    }

    /**
     * @param list<string> $a
     * @return list<string>
     */
    private function sorted(array $a): array
    {
        sort($a);

        return $a;
    }
}
