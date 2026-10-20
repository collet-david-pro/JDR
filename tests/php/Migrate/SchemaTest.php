<?php

declare(strict_types=1);

namespace JDR\Tests\Migrate;

use JDR\Core\Db;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

require_once __DIR__ . '/../Support/DbTestCase.php';

/**
 * Checks that 0001_initial.sql matches projet.md §7.1 / §7.2.
 */
final class SchemaTest extends DbTestCase
{
    /**
     * Columns of every table (§7.2).
     */
    private const COLUMNS = [
        'schema_migrations' => ['version', 'name', 'checksum', 'status', 'error', 'applied_at', 'duration_ms'],
        'settings' => ['key', 'value', 'updated_at'],
        'audit_log' => ['id', 'user_id', 'action', 'entity', 'entity_id', 'data', 'ip', 'created_at'],
        'rate_limits' => ['bucket', 'hits', 'window_start', 'blocked_until'],
        'background_jobs' => ['id', 'type', 'status', 'progress', 'result', 'created_by', 'created_at', 'updated_at'],
        'users' => [
            'id', 'email', 'username', 'password_hash', 'role', 'status', 'storage_quota_bytes', 'storage_used_bytes',
            'locale', 'email_verified_at', 'last_login_at', 'created_at', 'updated_at', 'deleted_at',
        ],
        'user_prefs' => ['user_id', 'key', 'value'],
        'remember_tokens' => [
            'id', 'user_id', 'selector', 'validator_hash', 'user_agent', 'expires_at', 'last_used_at', 'created_at',
        ],
        'password_resets' => ['id', 'user_id', 'token_hash', 'created_by', 'expires_at', 'used_at'],
        'login_attempts' => ['id', 'identifier', 'ip', 'success', 'created_at'],
        'invitations' => ['id', 'code_hash', 'email', 'created_by', 'max_uses', 'uses', 'expires_at', 'created_at'],
        'php_sessions' => ['id', 'user_id', 'data', 'ip', 'last_activity'],
        'games' => [
            'id', 'gm_user_id', 'name', 'description', 'cover_asset_id', 'world_map_id', 'settings', 'archived_at',
            'created_at', 'updated_at', 'deleted_at',
        ],
        'game_members' => ['game_id', 'user_id', 'role', 'joined_at'],
        'party_positions' => ['game_id', 'world_map_id', 'floor_id', 'x', 'y', 'updated_at'],
        'tokens' => [
            'id', 'game_id', 'name', 'asset_id', 'kind', 'size_w', 'size_h', 'default_owner_user_id', 'vision', 'light',
            'ring_color', 'created_at', 'updated_at', 'deleted_at',
        ],
        'encounters' => ['id', 'game_id', 'name', 'notes', 'created_at', 'updated_at'],
        'encounter_tokens' => ['encounter_id', 'token_id', 'dx', 'dy'],
        'asset_categories' => ['id', 'owner_user_id', 'parent_id', 'name', 'sort_order'],
        'assets' => [
            'id', 'uuid', 'owner_user_id', 'category_id', 'name', 'kind', 'mime', 'ext', 'width', 'height',
            'is_animated', 'frame_count', 'duration_ms', 'autotile', 'size_bytes', 'thumb_size_bytes', 'sha256',
            'source', 'created_at', 'updated_at', 'deleted_at',
        ],
        'asset_tags' => ['id', 'owner_user_id', 'name'],
        'asset_tag_map' => ['asset_id', 'tag_id'],
        'asset_favorites' => ['user_id', 'asset_id'],
        'map_asset_refs' => ['map_id', 'asset_id', 'ref_count'],
        'maps' => [
            'id', 'game_id', 'owner_user_id', 'name', 'folder', 'sort_order', 'kind', 'grid_type', 'cell_px',
            'width_cells', 'height_cells', 'unit_label', 'unit_per_cell', 'theme', 'ambient', 'palette', 'layers',
            'generation', 'format_version', 'revision', 'is_template', 'template_scope', 'thumb_asset_path',
            'created_at', 'updated_at', 'deleted_at',
        ],
        'map_floors' => ['id', 'map_id', 'level', 'name', 'sort_order'],
        'map_chunks' => ['map_id', 'floor_id', 'layer', 'cx', 'cy', 'data', 'revision', 'updated_at'],
        'map_objects' => [
            'id', 'uid', 'map_id', 'floor_id', 'layer', 'type', 'asset_id', 'geometry', 'props', 'note_id',
            'visibility', 'revealed_at', 'locked', 'sort_order', 'bbox_x1', 'bbox_y1', 'bbox_x2', 'bbox_y2', 'rev',
            'updated_at',
        ],
        'map_notes' => ['id', 'map_id', 'uid', 'title', 'body', 'asset_id', 'gm_only', 'read_aloud', 'updated_at'],
        'map_links' => ['id', 'from_map_id', 'from_object_id', 'to_map_id', 'to_floor_id', 'to_x', 'to_y'],
        'map_tokens' => [
            'id', 'uid', 'map_id', 'floor_id', 'token_id', 'x', 'y', 'rotation', 'scale', 'hidden', 'light_override',
            'rev', 'updated_at',
        ],
        'map_fog' => ['map_id', 'floor_id', 'cx', 'cy', 'data', 'updated_at'],
        'map_versions' => [
            'id', 'map_id', 'revision', 'kind', 'label', 'snapshot', 'size_bytes', 'created_by', 'created_at',
        ],
        'play_sessions' => [
            'id', 'game_id', 'code', 'name', 'state', 'current_map_id', 'current_floor_id', 'camera', 'pause_screen',
            'created_by', 'created_at', 'started_at', 'ended_at',
        ],
        'session_players' => ['session_id', 'user_id', 'status', 'ready', 'joined_at', 'last_seen_at'],
        'token_assignments' => ['session_id', 'token_id', 'user_id'],
        'session_displays' => [
            'id', 'session_id', 'name', 'pairing_code_hash', 'pairing_expires_at', 'device_token_hash', 'state',
            'settings', 'last_ip', 'user_agent', 'paired_at', 'last_seen_at', 'created_at',
        ],
        'events' => [
            'id', 'channel', 'type', 'audience', 'audience_user_id', 'payload', 'actor_user_id', 'client_op_id',
            'ephemeral', 'created_at',
        ],
        'processed_ops' => ['client_op_id', 'user_id', 'response', 'created_at'],
    ];

    /**
     * Foreign keys: name suffix (after fk_{prefix}) => [table, column, referenced table, ON DELETE].
     */
    private const FOREIGN_KEYS = [
        'audit_log_user' => ['audit_log', 'user_id', 'users', 'SET NULL'],
        'background_jobs_created_by' => ['background_jobs', 'created_by', 'users', 'SET NULL'],
        'user_prefs_user' => ['user_prefs', 'user_id', 'users', 'CASCADE'],
        'remember_tokens_user' => ['remember_tokens', 'user_id', 'users', 'CASCADE'],
        'password_resets_user' => ['password_resets', 'user_id', 'users', 'CASCADE'],
        'password_resets_created_by' => ['password_resets', 'created_by', 'users', 'SET NULL'],
        'invitations_created_by' => ['invitations', 'created_by', 'users', 'CASCADE'],
        'asset_categories_owner_user' => ['asset_categories', 'owner_user_id', 'users', 'CASCADE'],
        'asset_categories_parent' => ['asset_categories', 'parent_id', 'asset_categories', 'SET NULL'],
        'assets_owner_user' => ['assets', 'owner_user_id', 'users', 'CASCADE'],
        'assets_category' => ['assets', 'category_id', 'asset_categories', 'SET NULL'],
        'asset_tags_owner_user' => ['asset_tags', 'owner_user_id', 'users', 'CASCADE'],
        'asset_tag_map_asset' => ['asset_tag_map', 'asset_id', 'assets', 'CASCADE'],
        'asset_tag_map_tag' => ['asset_tag_map', 'tag_id', 'asset_tags', 'CASCADE'],
        'asset_favorites_user' => ['asset_favorites', 'user_id', 'users', 'CASCADE'],
        'asset_favorites_asset' => ['asset_favorites', 'asset_id', 'assets', 'CASCADE'],
        'games_gm_user' => ['games', 'gm_user_id', 'users', 'RESTRICT'],
        'games_cover_asset' => ['games', 'cover_asset_id', 'assets', 'SET NULL'],
        'games_world_map' => ['games', 'world_map_id', 'maps', 'SET NULL'],
        'game_members_game' => ['game_members', 'game_id', 'games', 'CASCADE'],
        'game_members_user' => ['game_members', 'user_id', 'users', 'CASCADE'],
        'tokens_game' => ['tokens', 'game_id', 'games', 'CASCADE'],
        'tokens_asset' => ['tokens', 'asset_id', 'assets', 'SET NULL'],
        'tokens_default_owner_user' => ['tokens', 'default_owner_user_id', 'users', 'SET NULL'],
        'encounters_game' => ['encounters', 'game_id', 'games', 'CASCADE'],
        'encounter_tokens_encounter' => ['encounter_tokens', 'encounter_id', 'encounters', 'CASCADE'],
        'encounter_tokens_token' => ['encounter_tokens', 'token_id', 'tokens', 'CASCADE'],
        'maps_game' => ['maps', 'game_id', 'games', 'CASCADE'],
        'maps_owner_user' => ['maps', 'owner_user_id', 'users', 'CASCADE'],
        'map_floors_map' => ['map_floors', 'map_id', 'maps', 'CASCADE'],
        'party_positions_game' => ['party_positions', 'game_id', 'games', 'CASCADE'],
        'party_positions_world_map' => ['party_positions', 'world_map_id', 'maps', 'CASCADE'],
        'party_positions_floor' => ['party_positions', 'floor_id', 'map_floors', 'SET NULL'],
        'map_chunks_map' => ['map_chunks', 'map_id', 'maps', 'CASCADE'],
        'map_chunks_floor' => ['map_chunks', 'floor_id', 'map_floors', 'CASCADE'],
        'map_notes_map' => ['map_notes', 'map_id', 'maps', 'CASCADE'],
        'map_notes_asset' => ['map_notes', 'asset_id', 'assets', 'SET NULL'],
        'map_objects_map' => ['map_objects', 'map_id', 'maps', 'CASCADE'],
        'map_objects_floor' => ['map_objects', 'floor_id', 'map_floors', 'CASCADE'],
        'map_objects_asset' => ['map_objects', 'asset_id', 'assets', 'SET NULL'],
        'map_objects_note' => ['map_objects', 'note_id', 'map_notes', 'SET NULL'],
        'map_links_from_map' => ['map_links', 'from_map_id', 'maps', 'CASCADE'],
        'map_links_from_object' => ['map_links', 'from_object_id', 'map_objects', 'CASCADE'],
        'map_links_to_map' => ['map_links', 'to_map_id', 'maps', 'CASCADE'],
        'map_links_to_floor' => ['map_links', 'to_floor_id', 'map_floors', 'SET NULL'],
        'map_tokens_map' => ['map_tokens', 'map_id', 'maps', 'CASCADE'],
        'map_tokens_floor' => ['map_tokens', 'floor_id', 'map_floors', 'CASCADE'],
        'map_tokens_token' => ['map_tokens', 'token_id', 'tokens', 'CASCADE'],
        'map_fog_map' => ['map_fog', 'map_id', 'maps', 'CASCADE'],
        'map_fog_floor' => ['map_fog', 'floor_id', 'map_floors', 'CASCADE'],
        'map_versions_map' => ['map_versions', 'map_id', 'maps', 'CASCADE'],
        'map_versions_created_by' => ['map_versions', 'created_by', 'users', 'SET NULL'],
        'map_asset_refs_map' => ['map_asset_refs', 'map_id', 'maps', 'CASCADE'],
        'map_asset_refs_asset' => ['map_asset_refs', 'asset_id', 'assets', 'CASCADE'],
        'play_sessions_game' => ['play_sessions', 'game_id', 'games', 'CASCADE'],
        'play_sessions_current_map' => ['play_sessions', 'current_map_id', 'maps', 'SET NULL'],
        'play_sessions_current_floor' => ['play_sessions', 'current_floor_id', 'map_floors', 'SET NULL'],
        'play_sessions_created_by' => ['play_sessions', 'created_by', 'users', 'SET NULL'],
        'session_players_session' => ['session_players', 'session_id', 'play_sessions', 'CASCADE'],
        'session_players_user' => ['session_players', 'user_id', 'users', 'CASCADE'],
        'token_assignments_session' => ['token_assignments', 'session_id', 'play_sessions', 'CASCADE'],
        'token_assignments_token' => ['token_assignments', 'token_id', 'tokens', 'CASCADE'],
        'token_assignments_user' => ['token_assignments', 'user_id', 'users', 'CASCADE'],
        'session_displays_session' => ['session_displays', 'session_id', 'play_sessions', 'CASCADE'],
    ];

    /**
     * Unique keys required by §7.2: table => list of column lists.
     */
    private const UNIQUE_KEYS = [
        'users' => [['email'], ['username']],
        'remember_tokens' => [['selector']],
        'password_resets' => [['token_hash']],
        'invitations' => [['code_hash']],
        'assets' => [['uuid']],
        'asset_tags' => [['owner_user_id', 'name']],
        'map_floors' => [['map_id', 'level']],
        'map_objects' => [['map_id', 'uid']],
        'map_tokens' => [['map_id', 'uid']],
        'play_sessions' => [['code']],
        'session_displays' => [['device_token_hash']],
    ];

    private static Db $db;

    public static function setUpBeforeClass(): void
    {
        self::$db = self::newDb();
        self::dropTestTables(self::$db);
        (new Runner(self::$db, self::migrationsDir()))->runAll();
    }

    public static function tearDownAfterClass(): void
    {
        self::dropTestTables(self::$db);
    }

    public function testExactlyTheSpecifiedTablesExist(): void
    {
        $prefix = self::$db->prefix();
        $actual = array_map(static fn (string $t): string => substr($t, strlen($prefix)), self::testTables(self::$db));
        $expected = self::SCHEMA_TABLES;
        sort($actual);
        sort($expected);
        self::assertSame($expected, $actual);
        self::assertSame(array_keys(self::COLUMNS), self::SCHEMA_TABLES);
    }

    /**
     * @return array<string, array{string, list<string>}>
     */
    public static function tableColumns(): array
    {
        $out = [];
        foreach (self::COLUMNS as $table => $columns) {
            $out[$table] = [$table, $columns];
        }

        return $out;
    }

    /**
     * @param list<string> $columns
     */
    #[DataProvider('tableColumns')]
    public function testTableHasItsColumns(string $table, array $columns): void
    {
        self::assertTrue(self::$db->tableExists($table), "Missing table $table");
        $actual = array_column(self::$db->fetchAll(
            'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS '
            . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
            [self::$db->prefix() . $table]
        ), 'c');
        self::assertSame($columns, $actual, "Columns of $table");
    }

    public function testTableOptions(): void
    {
        $rows = self::$db->fetchAll(
            'SELECT TABLE_NAME AS t, ENGINE AS e, ROW_FORMAT AS r, TABLE_COLLATION AS c FROM information_schema.TABLES '
            . 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?',
            [addcslashes(self::$db->prefix(), '_%') . '%']
        );
        self::assertCount(count(self::SCHEMA_TABLES), $rows);
        foreach ($rows as $row) {
            self::assertSame('InnoDB', $row['e'], $row['t']);
            self::assertSame('Dynamic', $row['r'], $row['t']);
            self::assertSame('utf8mb4_unicode_ci', $row['c'], $row['t']);
        }
    }

    public function testColumnConventions(): void
    {
        $rows = self::$db->fetchAll(
            'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d, COLUMN_TYPE AS ct, COLUMN_DEFAULT AS def, '
            . 'COLUMN_KEY AS k, CHARACTER_MAXIMUM_LENGTH AS len, COLLATION_NAME AS coll, EXTRA AS x '
            . 'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?',
            [addcslashes(self::$db->prefix(), '_%') . '%']
        );
        self::assertNotEmpty($rows);
        foreach ($rows as $row) {
            $where = $row['t'] . '.' . $row['c'];
            self::assertNotContains($row['d'], ['enum', 'set', 'timestamp'], "$where: forbidden type");
            self::assertStringNotContainsStringIgnoringCase('GENERATED', (string) $row['x'], "$where: generated");
            $lob = ['json', 'text', 'mediumtext', 'longtext', 'blob', 'mediumblob', 'longblob'];
            if (in_array($row['d'], $lob, true)) {
                self::assertNull($row['def'], "$where: no DEFAULT allowed on JSON/TEXT/BLOB (MySQL 5.7)");
            }
            if ($row['coll'] !== null) {
                self::assertSame('utf8mb4_unicode_ci', $row['coll'], $where);
            }
            if ($row['c'] === 'id' && $row['x'] === 'auto_increment') {
                self::assertSame('bigint unsigned', $row['ct'], "$where: primary keys are BIGINT UNSIGNED");
            }
            if (str_ends_with((string) $row['c'], '_at')) {
                self::assertSame('datetime', $row['d'], "$where: dates are DATETIME");
            }
        }
    }

    public function testIndexedTextColumnsFitUtf8mb4KeyLimit(): void
    {
        $rows = self::$db->fetchAll(
            'SELECT s.TABLE_NAME AS t, s.INDEX_NAME AS i, s.COLUMN_NAME AS c, c.CHARACTER_MAXIMUM_LENGTH AS len '
            . 'FROM information_schema.STATISTICS s JOIN information_schema.COLUMNS c '
            . 'ON c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME AND c.COLUMN_NAME = s.COLUMN_NAME '
            . "WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME LIKE ? AND c.DATA_TYPE IN ('varchar', 'char')",
            [addcslashes(self::$db->prefix(), '_%') . '%']
        );
        self::assertNotEmpty($rows);
        foreach ($rows as $row) {
            self::assertLessThanOrEqual(191, (int) $row['len'], $row['t'] . '.' . $row['c'] . ' in ' . $row['i']);
        }
    }

    public function testForeignKeysMatchSpecification(): void
    {
        $prefix = self::$db->prefix();
        $rows = self::$db->fetchAll(
            'SELECT rc.CONSTRAINT_NAME AS n, rc.TABLE_NAME AS t, rc.REFERENCED_TABLE_NAME AS rt, rc.DELETE_RULE AS d, '
            . 'k.COLUMN_NAME AS c '
            . 'FROM information_schema.REFERENTIAL_CONSTRAINTS rc JOIN information_schema.KEY_COLUMN_USAGE k '
            . 'ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME '
            . 'AND k.TABLE_NAME = rc.TABLE_NAME '
            . 'WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME LIKE ?',
            [addcslashes($prefix, '_%') . '%']
        );
        $actual = [];
        foreach ($rows as $row) {
            $name = (string) $row['n'];
            self::assertStringStartsWith('fk_' . $prefix, $name);
            $actual[substr($name, strlen('fk_' . $prefix))] = [
                substr((string) $row['t'], strlen($prefix)),
                (string) $row['c'],
                substr((string) $row['rt'], strlen($prefix)),
                (string) $row['d'],
            ];
        }
        $expected = self::FOREIGN_KEYS;
        ksort($expected);
        ksort($actual);
        self::assertSame($expected, $actual);
    }

    public function testUniqueKeys(): void
    {
        foreach (self::UNIQUE_KEYS as $table => $keys) {
            $rows = self::$db->fetchAll(
                'SELECT INDEX_NAME AS i, COLUMN_NAME AS c FROM information_schema.STATISTICS '
                . "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY' "
                . 'ORDER BY INDEX_NAME, SEQ_IN_INDEX',
                [self::$db->prefix() . $table]
            );
            $actual = [];
            foreach ($rows as $row) {
                $actual[$row['i']][] = $row['c'];
            }
            foreach ($keys as $columns) {
                $label = "$table: UNIQUE(" . implode(', ', $columns) . ')';
                self::assertContains($columns, array_values($actual), $label);
            }
        }
    }

    public function testIdentifiersFitWithLongestPrefix(): void
    {
        $sql = (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql');
        $sql = str_replace('{{prefix}}', str_repeat('p', 16), $sql);
        preg_match_all('/`([^`]+)`/', $sql, $m);
        self::assertNotEmpty($m[1]);
        foreach (array_unique($m[1]) as $identifier) {
            self::assertLessThanOrEqual(64, strlen($identifier), $identifier);
        }
    }

    public function testInitialMigrationAvoidsNonPortableSyntax(): void
    {
        $sql = (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql');
        self::assertMatchesRegularExpression('/^-- @idempotent-ddl$/m', $sql);
        foreach (['/\bENUM\s*\(/i', '/\bCHECK\s*\(/i', '/\bGENERATED\b/i', '/\bTIMESTAMP\b/i', '/\bJSON_[A-Z]+\s*\(/i',
            '/ALGORITHM\s*=\s*INSTANT/i', '/\bTRIGGER\b/i', '/\bPROCEDURE\b/i',
            '/ADD\s+(COLUMN\s+)?IF\s+NOT\s+EXISTS/i',
            '/DEFAULT\s*\(/i', '/\bNOW\(\)/i'] as $pattern) {
            $withoutComments = (string) preg_replace('/^\s*--.*$/m', '', $sql);
            self::assertDoesNotMatchRegularExpression($pattern, $withoutComments, $pattern);
        }
        self::assertSame(
            substr_count($sql, 'CREATE TABLE IF NOT EXISTS') - 1, // one occurrence is in the header comment
            count(self::SCHEMA_TABLES)
        );
    }

    public function testReferentialActionsWork(): void
    {
        $db = self::$db;
        $now = gmdate('Y-m-d H:i:s');
        $db->transaction(function (Db $db) use ($now): void {
            $db->execute(
                'INSERT INTO ' . $db->t('users') . ' (email, username, password_hash, created_at, updated_at) '
                . 'VALUES (?, ?, ?, ?, ?)',
                ['gm@example.test', 'gm', 'x', $now, $now]
            );
            $userId = (int) $db->lastInsertId();
            $db->execute(
                'INSERT INTO ' . $db->t('games') . ' (gm_user_id, name, settings, created_at, updated_at) '
                . 'VALUES (?, ?, ?, ?, ?)',
                [$userId, 'Campaign', '{}', $now, $now]
            );
            $gameId = (int) $db->lastInsertId();
            $db->execute(
                'INSERT INTO ' . $db->t('maps') . ' (game_id, owner_user_id, name, width_cells, height_cells, ambient, '
                . 'palette, layers, format_version, created_at, updated_at) VALUES (?, ?, ?, 30, 20, ?, ?, ?, 1, ?, ?)',
                [$gameId, $userId, 'World', '{}', '[null]', '[]', $now, $now]
            );
            $mapId = (int) $db->lastInsertId();
            $db->execute('UPDATE ' . $db->t('games') . ' SET world_map_id = ? WHERE id = ?', [$mapId, $gameId]);
            $db->execute(
                'INSERT INTO ' . $db->t('map_floors') . ' (map_id, level, name) VALUES (?, 0, ?)',
                [$mapId, 'Ground']
            );
        });

        // RESTRICT: a GM with games cannot be deleted.
        try {
            $db->execute('DELETE FROM ' . $db->t('users') . ' WHERE username = ?', ['gm']);
            self::fail('RESTRICT expected');
        } catch (\PDOException $e) {
            self::assertSame(1451, $e->errorInfo[1]);
        }

        // SET NULL: deleting the world map clears games.world_map_id; CASCADE removes its floors.
        $db->execute('DELETE FROM ' . $db->t('maps'));
        self::assertNull($db->fetchValue('SELECT world_map_id FROM ' . $db->t('games')));
        self::assertSame(0, $db->fetchValue('SELECT COUNT(*) FROM ' . $db->t('map_floors')));

        // Defaults from §7.2.
        $user = $db->fetchOne('SELECT role, status, storage_used_bytes, locale FROM ' . $db->t('users'));
        self::assertSame(['role' => 'user', 'status' => 'active', 'storage_used_bytes' => 0, 'locale' => 'fr'], $user);

        self::truncateTestTables($db);
        self::assertSame(0, $db->fetchValue('SELECT COUNT(*) FROM ' . $db->t('users')));
        self::assertSame(
            count(\JDR\Migrate\MigrationFile::discover(self::migrationsDir())),
            $db->fetchValue('SELECT COUNT(*) FROM ' . $db->t('schema_migrations'))
        );
    }
}
