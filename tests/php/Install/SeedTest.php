<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\Migration;
use JDR\Migrate\Runner;

final class SeedTest extends InstallDbTestCase
{
    private Db $db;

    protected function setUp(): void
    {
        $this->db = self::installDb();
        self::dropTestTables($this->db);
    }

    protected function tearDown(): void
    {
        self::dropTestTables($this->db);
    }

    private function seed(): Migration
    {
        $migration = require self::migrationsDir() . '/0002_seed.php';
        self::assertInstanceOf(Migration::class, $migration);

        return $migration;
    }

    /**
     * @return array<string, mixed>
     */
    private function settings(): array
    {
        $out = [];
        foreach ($this->db->fetchAll('SELECT `key`, `value` FROM ' . $this->db->t('settings')) as $row) {
            $out[(string) $row['key']] = json_decode((string) $row['value'], true);
        }

        return $out;
    }

    public function testRunnerAppliesSeedAndSetsDbVersion(): void
    {
        $done = (new Runner($this->db, self::migrationsDir()))->runAll();
        self::assertSame(['0001', '0002'], array_slice(array_column($done, 'version'), 0, 2));

        $s = $this->settings();
        self::assertSame(\REQUIRED_DB_VERSION, $s['db_version']);
        self::assertSame('JDR', $s['site_name']);
        self::assertSame('fr', $s['default_locale']);
        self::assertSame('open', $s['registration_mode']);
        self::assertSame(524288000, $s['default_quota_bytes']);
        self::assertSame(10485760, $s['max_upload_bytes']);
        self::assertSame(4096, $s['max_dimension_px']);
        self::assertSame(16777216, $s['max_total_pixels']);
        self::assertSame(300, $s['max_frames']);
        self::assertSame(20000, $s['max_animation_ms']);
        self::assertSame(24, $s['events_retention_hours']);
        self::assertSame(30, $s['versions_retention']);
        self::assertSame(30, $s['trash_days']);
        self::assertSame(12, $s['session_idle_hours']);
        self::assertFalse($s['use_db_sessions']);
        self::assertFalse($s['maintenance']);
        self::assertArrayHasKey('smtp', $s);
        self::assertNull($s['smtp']);

        $names = $this->db->fetchAll('SELECT name FROM ' . $this->db->t('asset_categories')
            . ' WHERE owner_user_id IS NULL ORDER BY sort_order');
        self::assertSame(
            ['Sols', 'Murs', 'Portes', 'Mobilier', 'Nature', 'Eau', 'Lumières', 'Tokens', 'Textures'],
            array_column($names, 'name')
        );
    }

    public function testSeedIsReplayableAndKeepsChangedValues(): void
    {
        (new Runner($this->db, self::migrationsDir()))->runAll();
        $this->db->execute('UPDATE ' . $this->db->t('settings') . " SET `value` = ? WHERE `key` = 'site_name'", ['"Ma table"']);
        $this->db->execute('DELETE FROM ' . $this->db->t('settings') . " WHERE `key` = 'trash_days'");
        $before = (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('asset_categories'));

        $log = new CallbackLogger();
        $this->seed()->up($this->db, $log);
        $this->seed()->up($this->db, $log);

        $s = $this->settings();
        self::assertSame('Ma table', $s['site_name'], 'a changed value is never overwritten');
        self::assertSame(30, $s['trash_days'], 'a missing value is restored');
        self::assertSame($before, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('asset_categories')));
        self::assertSame(9, $before);
        self::assertNotEmpty($log->entries());
    }

    public function testUserCategoriesWithTheSameNameDoNotBlockTheGeneralOnes(): void
    {
        (new Runner($this->db, self::migrationsDir()))->runNext(); // 0001 only
        $now = gmdate('Y-m-d H:i:s');
        $this->db->execute('INSERT INTO ' . $this->db->t('users')
            . " (email, username, password_hash, created_at, updated_at) VALUES ('u@x.fr', 'u', '\$x', ?, ?)", [$now, $now]);
        $uid = (int) $this->db->lastInsertId();
        $this->db->execute('INSERT INTO ' . $this->db->t('asset_categories')
            . " (owner_user_id, name, sort_order) VALUES (?, 'Murs', 0)", [$uid]);

        $this->seed()->up($this->db, new CallbackLogger());
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('asset_categories')
            . " WHERE owner_user_id IS NULL AND name = 'Murs'"));
    }
}
