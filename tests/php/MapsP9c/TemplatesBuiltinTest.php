<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9c;

use JDR\Core\Logger;
use JDR\Domain\Maps\BuiltinTemplates;
use JDR\Domain\Maps\MapFloorRepository;
use JDR\Domain\Maps\MapLinks;
use JDR\Domain\Maps\MapNotes;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Procgen\BasePackInstaller;
use JDR\Domain\Settings\Settings;

/**
 * The four built-in templates: lazy and idempotent installation, deletion, missing pack key,
 * and the shipped files themselves (P9c1).
 */
final class TemplatesBuiltinTest extends TemplatesTestCase
{
    private const IDS = ['taverne', 'crypte', 'foret', 'grotte'];

    private function builtinRows(): int
    {
        return $this->rows('maps', "`is_template` = 1 AND `template_scope` = 'site'");
    }

    private function settingValue(): array
    {
        $this->app->container()->get(Settings::class)->refresh();
        $value = $this->app->container()->get(Settings::class)->get(BuiltinTemplates::SETTING);

        return is_array($value) ? $value : [];
    }

    private function installer(string $dir): BuiltinTemplates
    {
        $c = $this->app->container();

        return new BuiltinTemplates(
            $this->db,
            $c->get(Settings::class),
            $c->get(Logger::class),
            $c->get(MapRepository::class),
            $c->get(MapSceneRepository::class),
            $c->get(MapFloorRepository::class),
            $c->get(MapLinks::class),
            $c->get(MapNotes::class),
            $c->get(BasePackInstaller::class),
            $dir,
        );
    }

    public function testShippedFilesAreListedAndSmall(): void
    {
        $dir = dirname(__DIR__, 3) . '/app/Domain/Maps/templates';
        $manifest = json_decode((string) file_get_contents($dir . '/manifest.json'), true);
        self::assertSame(self::IDS, array_column($manifest['templates'], 'id'));
        foreach ($manifest['templates'] as $t) {
            self::assertLessThan(500_000, filesize($dir . '/' . $t['file']), $t['file']);
            $file = json_decode((string) file_get_contents($dir . '/' . $t['file']), true);
            self::assertGreaterThanOrEqual(40, $file['width']);
            self::assertLessThanOrEqual(60, $file['width']);
        }
    }

    public function testInstalledOnceAndIdempotent(): void
    {
        $w = $this->tw();
        $rows = $this->listTpl($w['eve']);
        self::assertSame(['Crypte', 'Forêt', 'Grotte', 'Taverne'], array_column($rows, 'name'));
        foreach ($rows as $row) {
            self::assertTrue($row['builtin']);
            self::assertSame('site', $row['scope']);
            self::assertFalse($row['can_delete'], 'a player of the site does not delete');
            self::assertFalse($row['owned']);
            self::assertSame(1, $row['floors']);
            self::assertGreaterThanOrEqual(2, $row['notes']);
        }
        self::assertSame(array_fill(0, 4, true), array_column($this->listTpl($w['admin']), 'can_delete'));
        $this->listTpl($w['gm']);
        self::assertSame(4, $this->builtinRows());
        $state = $this->settingValue();
        self::assertSame(1, $state['version']);
        $keys = array_keys($state['ids']);
        sort($keys);
        $expected = self::IDS;
        sort($expected);
        self::assertSame($expected, $keys);
        self::assertSame($this->userId('Root'), (int) $this->mapRow(reset($state['ids']))['owner_user_id'], 'owner: the first admin');
    }

    public function testAStaleVersionDoesNotInstallTwice(): void
    {
        $w = $this->tw();
        $this->listTpl($w['gm']);
        $state = $this->settingValue();
        $this->setSetting(BuiltinTemplates::SETTING, ['version' => 0] + $state);
        $this->app->container()->get(Settings::class)->refresh();
        $this->listTpl($w['gm']);
        $this->listTpl($w['eve']);
        self::assertSame(4, $this->builtinRows());
        self::assertSame(1, $this->settingValue()['version'], 'version settled again');
        self::assertSame($state['ids'], $this->settingValue()['ids']);
    }

    public function testEachBuiltinMakesAUsableMap(): void
    {
        $w = $this->tw();
        foreach ($this->listTpl($w['gm']) as $row) {
            $map = $this->instantiateTpl($w['gm'], $row['id'], $w['game'], ['name' => 'Test ' . $row['name']]);
            $id = (int) $map['id'];
            self::assertGreaterThanOrEqual(1, count($map['floors']), $row['name']);
            self::assertGreaterThan(1, count($map['palette']), $row['name'] . ': palette');
            self::assertNotNull($map['palette'][1]['asset_id']);
            self::assertGreaterThan(0, $this->countRows('map_chunks', $id), $row['name'] . ': tiles');
            self::assertGreaterThan(0, $this->countRows('map_asset_refs', $id));
            self::assertGreaterThanOrEqual(2, $this->countRows('map_notes', $id), $row['name'] . ': notes');
            self::assertSame(0, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('map_notes') . " WHERE `map_id` = ? AND `audience` <> 'gm'", [$id]));
            $types = array_count_values(array_column($this->db->fetchAll('SELECT `type` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ?', [$id]), 'type'));
            self::assertGreaterThan(0, $types['light'] ?? 0, $row['name'] . ': lights');
            if ($row['name'] !== 'Forêt') {
                self::assertGreaterThan(0, $types['wall'] ?? 0, $row['name'] . ': walls');
            }
            self::assertGreaterThan(0, $types['pin'] ?? 0, $row['name'] . ': pins');
            self::assertSame(0, $this->countRows('map_tokens', $id) + $this->countRows('map_fog', $id));
            // The map opens in the editor of its game.
            self::assertSame(200, $w['gm']->get('/maps/' . $id)->status());
        }
    }

    public function testADeletedBuiltinIsNotInstalledAgain(): void
    {
        $w = $this->tw();
        $rows = array_column($this->listTpl($w['admin']), null, 'name');
        self::assertSame(204, $w['admin']->delete('/templates/' . $rows['Taverne']['id'])->status());
        self::assertSame(['Crypte', 'Forêt', 'Grotte'], array_column($this->listTpl($w['gm']), 'name'));
        self::assertSame(['taverne'], $this->settingValue()['deleted']);
        // Even with a version that looks old.
        $this->setSetting(BuiltinTemplates::SETTING, ['version' => 0] + $this->settingValue());
        $this->app->container()->get(Settings::class)->refresh();
        self::assertSame(['Crypte', 'Forêt', 'Grotte'], array_column($this->listTpl($w['gm']), 'name'));
        self::assertSame(3, $this->builtinRows());
    }

    public function testAMissingPackKeyInstallsNothingAndRetriesLater(): void
    {
        $w = $this->tw();
        $dir = sys_get_temp_dir() . '/jdr-tpl-' . bin2hex(random_bytes(4));
        mkdir($dir);
        try {
            $ops = static fn (string $key): array => [
                ['type' => 'palette.add', 'index' => 1, 'asset_id' => 'pack:' . $key],
                ['type' => 'tiles.set', 'floor' => 'f1', 'layer' => 'ground', 'cells' => [[0, 0, 1, 0, 0], [1, 0, 1, 0, 0]]],
                ['type' => 'note.add', 'note' => ['uid' => 'n1', 'title' => 'T', 'body' => 'B', 'audience' => 'gm']],
            ];
            $write = static function (string $key) use ($dir, $ops): void {
                file_put_contents($dir . '/manifest.json', json_encode(['version' => 7, 'templates' => [['id' => 'mini', 'file' => 'mini.json']]]));
                file_put_contents($dir . '/mini.json', json_encode([
                    'id' => 'mini', 'name' => 'Mini', 'kind' => 'battle', 'theme' => 'parchment', 'width' => 20, 'height' => 20, 'cell_px' => 70,
                    'unit_label' => 'ft', 'unit_per_cell' => 5, 'floor' => 'f1', 'ops' => $ops($key),
                ]));
            };
            $write('no.such.key');
            $installer = $this->installer($dir);
            $installer->ensureInstalled();
            self::assertSame(0, $this->builtinRows());
            self::assertNotSame(7, $this->settingValue()['version'] ?? 0, 'the version is not frozen');

            $packKey = array_key_first($this->app->container()->get(BasePackInstaller::class)->ensureInstalled());
            $write((string) $packKey);
            $installer->ensureInstalled();
            $installer->ensureInstalled();
            self::assertSame(1, $this->builtinRows());
            $state = $this->settingValue();
            self::assertSame(7, $state['version']);
            self::assertSame(['mini'], array_keys($state['ids']));
            self::assertSame(1, $this->countRows('map_notes', $state['ids']['mini']));
            self::assertGreaterThan(0, $this->countRows('map_asset_refs', $state['ids']['mini']));
        } finally {
            array_map('unlink', glob($dir . '/*') ?: []);
            @rmdir($dir);
        }
    }

    public function testNoAdminNoInstallation(): void
    {
        $gm = $this->user('Alice');
        self::assertSame([], $this->listTpl($gm));
        self::assertSame(0, $this->builtinRows());
        self::assertSame([], $this->settingValue());
    }
}
