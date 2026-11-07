<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\Migration;
use JDR\Tests\Support\DbTestCase;

require_once __DIR__ . '/../Support/DbTestCase.php';

/**
 * Migration 0007_site_name_clairvoie: the former default "JDR" becomes "Clairvoie", any other name is kept,
 * replayable.
 */
final class SiteNameMigrationTest extends DbTestCase
{
    private Db $db;

    protected function setUp(): void
    {
        $this->db = self::newDb();
        self::dropTestTables($this->db);
        $dir = self::makeMigrationsDir(['0001_initial.sql' => (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql')]);
        try {
            (new \JDR\Migrate\Runner($this->db, $dir))->runAll();
        } finally {
            self::removeDir($dir);
        }
    }

    protected function tearDown(): void
    {
        self::dropTestTables($this->db);
    }

    private function storeName(string $name): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('settings') . ' (`key`, `value`, `updated_at`) VALUES (?, ?, ?) '
            . 'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
            ['site_name', json_encode($name), $now],
        );
    }

    private function siteName(): mixed
    {
        return json_decode((string) $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . ' WHERE `key` = ?', ['site_name']), true);
    }

    private function migrate(): void
    {
        $migration = require self::migrationsDir() . '/0007_site_name_clairvoie.php';
        self::assertInstanceOf(Migration::class, $migration);
        $migration->up($this->db, new CallbackLogger(static function (): void {
        }));
    }

    public function testDefaultNameIsRenamedAndReplayable(): void
    {
        $this->storeName('JDR');
        $this->migrate();
        self::assertSame('Clairvoie', $this->siteName());
        $this->migrate();
        self::assertSame('Clairvoie', $this->siteName());
    }

    public function testCustomNameIsKept(): void
    {
        $this->storeName('La Table des Ombres');
        $this->migrate();
        self::assertSame('La Table des Ombres', $this->siteName());
    }
}
