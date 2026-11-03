<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Db;
use JDR\Migrate\MigrationFailedException;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

require_once __DIR__ . '/../Support/DbTestCase.php';

/**
 * Update N -> N+1 on a realistic data set: a site installed with the schema of v0.1.0-alpha.1 (migrations up to 0004)
 * is brought to REQUIRED_DB_VERSION one migration per step, like update.php (Runner::runNext). Nothing may be lost.
 */
final class UpgradeFromPublishedTest extends DbTestCase
{
    private Db $db;
    private string $dir;
    private string $assetsDir;

    protected function setUp(): void
    {
        $this->db = self::newDb();
        self::dropTestTables($this->db);
        $files = [];
        foreach (['0001_initial.sql', '0002_seed.php', '0003_events_seq.sql', '0004_revoke_ended_displays.sql'] as $name) {
            $files[$name] = (string) file_get_contents(self::migrationsDir() . '/' . $name);
        }
        $this->dir = self::makeMigrationsDir($files);
        (new Runner($this->db, $this->dir))->runAll();
        $this->assetsDir = sys_get_temp_dir() . '/jdr-upgrade-assets-' . bin2hex(random_bytes(4));
        mkdir($this->assetsDir, 0700, true);
    }

    protected function tearDown(): void
    {
        self::removeDir($this->dir);
        foreach (glob($this->assetsDir . '/*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($this->assetsDir);
        self::dropTestTables($this->db);
    }

    private function copyMigration(string $name): void
    {
        copy(self::migrationsDir() . '/' . $name, $this->dir . '/' . $name);
    }

    private function insert(string $table, array $row): int
    {
        $cols = implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', array_keys($row)));
        $this->db->execute('INSERT INTO ' . $this->db->t($table) . ' (' . $cols . ') VALUES (' . implode(', ', array_fill(0, count($row), '?')) . ')', array_values($row));

        return (int) $this->db->lastInsertId();
    }

    /**
     * @return array{chunks:array<string,string>,files:array<string,string>}
     */
    private function seed(): array
    {
        $now = '2026-10-01 10:00:00';
        $admin = $this->insert('users', ['email' => 'admin@example.org', 'username' => 'Admin', 'password_hash' => 'h', 'role' => 'admin', 'created_at' => $now, 'updated_at' => $now]);
        $gm = $this->insert('users', ['email' => 'gm@example.org', 'username' => 'Maitre', 'password_hash' => 'h', 'created_at' => $now, 'updated_at' => $now]);
        $player = $this->insert('users', ['email' => 'p@example.org', 'username' => 'Joueur', 'password_hash' => 'h', 'created_at' => $now, 'updated_at' => $now]);
        $this->insert('settings', ['key' => 'table_name', 'value' => json_encode('Table du jeudi'), 'updated_at' => $now]);
        $game = $this->insert('games', ['gm_user_id' => $gm, 'name' => 'Campagne', 'settings' => '{}', 'created_at' => $now, 'updated_at' => $now]);
        $this->insert('game_members', ['game_id' => $game, 'user_id' => $gm, 'role' => 'gm', 'joined_at' => $now]);
        $this->insert('game_members', ['game_id' => $game, 'user_id' => $player, 'role' => 'player', 'joined_at' => $now]);

        $files = [];
        $assets = [];
        foreach (['dungeon', 'goblin'] as $i => $name) {
            $content = random_bytes(3000 + $i);
            $uuid = sprintf('00000000-0000-4000-8000-%012d', $i + 1);
            file_put_contents($this->assetsDir . '/' . $uuid . '.png', $content);
            $files[$uuid] = hash('sha256', $content);
            $assets[] = $this->insert('assets', [
                'uuid' => $uuid, 'owner_user_id' => $gm, 'name' => $name, 'kind' => 'image', 'mime' => 'image/png', 'ext' => 'png',
                'width' => 64, 'height' => 64, 'size_bytes' => strlen($content), 'thumb_size_bytes' => 10,
                'sha256' => hash('sha256', $content), 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        $chunks = [];
        $notes = [];
        $tokenId = $this->insert('tokens', ['game_id' => $game, 'name' => 'Gobelin', 'asset_id' => $assets[1], 'kind' => 'npc', 'vision' => '{}', 'created_at' => $now, 'updated_at' => $now]);
        foreach ([[3, 'Donjon'], [1, 'Village']] as $m => [$floorCount, $name]) {
            $map = $this->insert('maps', [
                'game_id' => $game, 'owner_user_id' => $gm, 'name' => $name, 'width_cells' => 64, 'height_cells' => 64,
                'ambient' => '{}', 'palette' => '[]', 'layers' => '[]', 'format_version' => 1, 'created_at' => $now, 'updated_at' => $now,
            ]);
            // Levels and sort orders chosen so that uids follow (sort_order, level, id), not the insertion order.
            $orders = $floorCount === 3 ? [[0, 'Rez', 2], [1, 'Etage', 1], [-1, 'Cave', 0]] : [[0, 'Rue', 0]];
            foreach ($orders as [$level, $floorName, $sort]) {
                $floor = $this->insert('map_floors', ['map_id' => $map, 'level' => $level, 'name' => $floorName, 'sort_order' => $sort]);
                foreach ([[0, 0], [1, 0], [0, 1]] as [$cx, $cy]) {
                    $data = random_bytes(512) . "\0\0\xff" . random_bytes(64);
                    $this->db->execute(
                        'INSERT INTO ' . $this->db->t('map_chunks') . ' (`map_id`, `floor_id`, `layer`, `cx`, `cy`, `data`, `revision`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
                        [$map, $floor, 'tiles', $cx, $cy, $data, $now],
                    );
                    $chunks[$map . '/' . $floor . '/tiles/' . $cx . '/' . $cy] = hash('sha256', $data);
                }
                $this->insert('map_objects', [
                    'uid' => 'o' . $map . 'x' . $floor, 'map_id' => $map, 'floor_id' => $floor, 'layer' => 'objects', 'type' => 'prop',
                    'geometry' => '{"x":1,"y":2}', 'props' => '{}', 'bbox_x1' => 1, 'bbox_y1' => 2, 'bbox_x2' => 3, 'bbox_y2' => 4, 'updated_at' => $now,
                ]);
                $this->insert('map_tokens', ['uid' => 't' . $map . 'x' . $floor, 'map_id' => $map, 'floor_id' => $floor, 'token_id' => $tokenId, 'x' => 4.5, 'y' => 5.5, 'updated_at' => $now]);
            }
            foreach ([1, 0] as $n => $gmOnly) {
                $uid = 'n' . $map . 'x' . $n;
                $this->insert('map_notes', ['map_id' => $map, 'uid' => $uid, 'title' => 'Note ' . $n, 'body' => "Texte é\n" . $n, 'gm_only' => $gmOnly, 'updated_at' => $now]);
                $notes[$uid] = $gmOnly === 1 ? 'gm' : 'all';
            }
        }
        $session = $this->insert('play_sessions', ['game_id' => $game, 'code' => 'ABCD2345', 'name' => 'Séance 1', 'state' => 'ended', 'created_by' => $gm, 'created_at' => $now, 'started_at' => $now, 'ended_at' => $now]);
        $this->insert('session_players', ['session_id' => $session, 'user_id' => $player, 'status' => 'left', 'joined_at' => $now, 'last_seen_at' => $now]);
        unset($admin);

        return ['chunks' => $chunks, 'files' => $files, 'notes' => $notes];
    }

    /**
     * @return array<string, int> rows per table, schema_migrations aside
     */
    private function counts(): array
    {
        $out = [];
        foreach (self::testTables($this->db) as $table) {
            $short = substr($table, strlen($this->db->prefix()));
            if ($short !== 'schema_migrations') {
                $out[$short] = (int) $this->db->fetchValue('SELECT COUNT(*) FROM `' . $table . '`');
            }
        }
        ksort($out);

        return $out;
    }

    /**
     * @return list<string> versions applied, one per call like update.php
     */
    private function migrateStepByStep(): array
    {
        $applied = [];
        for ($i = 0; $i < 20; $i++) {
            $done = (new Runner($this->db, $this->dir))->runNext();
            if ($done === null) {
                break;
            }
            $applied[] = $done['version'];
        }

        return $applied;
    }

    public function testNothingIsLostFromSchema0004ToTheRequiredVersion(): void
    {
        $seed = $this->seed();
        $before = $this->counts();
        self::assertSame('0004', (new Runner($this->db, $this->dir))->currentVersion());
        self::assertGreaterThanOrEqual(12, $before['map_chunks']);

        $this->copyMigration('0005_floor_uids.php');
        $this->copyMigration('0006_notes_audience.php');
        self::assertSame(['0005', '0006'], $this->migrateStepByStep());
        self::assertSame(\REQUIRED_DB_VERSION, (new Runner($this->db, $this->dir))->currentVersion());
        self::assertSame(\REQUIRED_DB_VERSION, json_decode((string) $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . " WHERE `key` = 'db_version'"), true));

        $after = $this->counts();
        self::assertSame(0, $after['map_note_users']);
        unset($after['map_note_users']);
        self::assertSame($before, $after, 'no row lost or added in any table');
        self::assertSame('"Table du jeudi"', $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . " WHERE `key` = 'table_name'"));

        // Chunks: identical byte for byte.
        $rows = $this->db->fetchAll('SELECT `map_id`, `floor_id`, `layer`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_chunks'));
        $got = [];
        foreach ($rows as $r) {
            $got[$r['map_id'] . '/' . $r['floor_id'] . '/' . $r['layer'] . '/' . $r['cx'] . '/' . $r['cy']] = hash('sha256', (string) $r['data']);
        }
        ksort($got);
        ksort($seed['chunks']);
        self::assertSame($seed['chunks'], $got);

        // Asset files are not touched by migrations.
        foreach ($seed['files'] as $uuid => $sha) {
            self::assertSame($sha, hash_file('sha256', $this->assetsDir . '/' . $uuid . '.png'));
        }

        // 0005: uids f1.. per map in (sort_order, level, id) order.
        $floors = $this->db->fetchAll('SELECT f.`uid`, f.`name`, m.`name` AS map FROM ' . $this->db->t('map_floors') . ' f JOIN ' . $this->db->t('maps') . ' m ON m.`id` = f.`map_id` ORDER BY m.`name`, f.`uid`');
        self::assertSame(
            [['f1', 'Rue', 'Village'], ['f1', 'Cave', 'Donjon'], ['f2', 'Etage', 'Donjon'], ['f3', 'Rez', 'Donjon']],
            array_map(static fn (array $r): array => [$r['uid'], $r['name'], $r['map']], [$floors[3], $floors[0], $floors[1], $floors[2]]),
        );
        self::assertSame(4, count($floors));

        // 0006: gm_only = 1 -> gm, gm_only = 0 -> all.
        foreach ($this->db->fetchAll('SELECT `uid`, `audience` FROM ' . $this->db->t('map_notes')) as $n) {
            self::assertSame($seed['notes'][$n['uid']], $n['audience'], $n['uid']);
        }
    }

    public function testAMigrationFailedHalfWayIsReplayedFromTheMiddle(): void
    {
        $seed = $this->seed();
        $before = $this->counts();

        // 0005 interrupted after the uids were written, before the NOT NULL / UNIQUE step.
        $real = (string) file_get_contents(self::migrationsDir() . '/0005_floor_uids.php');
        $marker = "        \$db->pdo()->exec('ALTER TABLE ' . \$table . ' MODIFY COLUMN `uid` CHAR(21) NOT NULL');";
        self::assertStringContainsString($marker, $real);
        file_put_contents($this->dir . '/0005_floor_uids.php', str_replace($marker, "        throw new \\RuntimeException('simulated crash');\n" . $marker, $real));
        $this->copyMigration('0006_notes_audience.php');
        try {
            $this->migrateStepByStep();
            self::fail('the simulated crash must stop the update');
        } catch (MigrationFailedException $e) {
            self::assertStringContainsString('simulated crash', $e->getMessage());
        }
        self::assertSame('0004', (new Runner($this->db, $this->dir))->currentVersion());
        self::assertSame('failed', $this->db->fetchValue('SELECT `status` FROM ' . $this->db->t('schema_migrations') . " WHERE `version` = '0005'"));

        // The fixed file replays: "Retry" of update.php.
        $this->copyMigration('0005_floor_uids.php');
        self::assertSame(['0005', '0006'], $this->migrateStepByStep());
        $after = $this->counts();
        unset($after['map_note_users']);
        self::assertSame($before, $after);
        self::assertSame(['f1', 'f1', 'f2', 'f3'], array_column($this->db->fetchAll('SELECT `uid` FROM ' . $this->db->t('map_floors') . ' ORDER BY `uid`'), 'uid'));
        self::assertCount(count($seed['notes']), $this->db->fetchAll('SELECT 1 FROM ' . $this->db->t('map_notes') . " WHERE `audience` IN ('gm', 'all')"));
    }
}
