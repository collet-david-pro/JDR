<?php

declare(strict_types=1);

namespace JDR\Tests\Migrate;

use JDR\Migrate\Checksums;
use JDR\Migrate\MigrationException;
use JDR\Migrate\MigrationFile;
use JDR\Tests\Support\DbTestCase;

require_once __DIR__ . '/../Support/DbTestCase.php';

/**
 * Discovery, naming and checksums (no database access).
 */
final class MigrationFileTest extends DbTestCase
{
    /** @var list<string> */
    private array $dirs = [];

    protected function tearDown(): void
    {
        foreach ($this->dirs as $dir) {
            self::removeDir($dir);
        }
    }

    public function testDiscoverySortsAndIgnoresForeignFiles(): void
    {
        $this->dirs[] = $dir = self::makeMigrationsDir([
            '0002_second.php' => '<?php return null;',
            '0001_first.sql' => 'SELECT 1;',
            '0010_tenth.sql' => 'SELECT 1;',
            'index.php' => '<?php',
            '.htaccess' => 'Require all denied',
            '0003-bad-name.sql' => 'SELECT 1;',
            '0004_UPPER.sql' => 'SELECT 1;',
            '04_short.sql' => 'SELECT 1;',
            '0005_notes.txt' => '',
        ]);
        $files = MigrationFile::discover($dir);
        self::assertSame(['0001', '0002', '0010'], array_map(static fn (MigrationFile $f) => $f->version, $files));
        self::assertSame(['first', 'second', 'tenth'], array_map(static fn (MigrationFile $f) => $f->name, $files));
        self::assertSame(['sql', 'php', 'sql'], array_map(static fn (MigrationFile $f) => $f->type, $files));
    }

    public function testDuplicateVersionIsRejected(): void
    {
        $this->dirs[] = $dir = self::makeMigrationsDir([
            '0001_a.sql' => 'SELECT 1;',
            '0001_b.php' => '<?php return null;',
        ]);
        $this->expectException(MigrationException::class);
        $this->expectExceptionMessage('Duplicate migration version 0001');
        MigrationFile::discover($dir);
    }

    public function testMissingDirectoryIsRejected(): void
    {
        $this->expectException(MigrationException::class);
        MigrationFile::discover('/nonexistent/' . bin2hex(random_bytes(4)));
    }

    public function testChecksumIsSha256AndIgnoresLineEndings(): void
    {
        $lf = "CREATE TABLE t (a INT);\nSELECT 1;\n";
        self::assertSame(hash('sha256', $lf), Checksums::ofString($lf));
        self::assertSame(Checksums::ofString($lf), Checksums::ofString(str_replace("\n", "\r\n", $lf)));
        self::assertNotSame(Checksums::ofString($lf), Checksums::ofString($lf . ' '));
    }

    public function testIdempotentMarkerDetection(): void
    {
        $this->dirs[] = $dir = self::makeMigrationsDir([
            '0001_with.sql' => "-- @idempotent-ddl\nCREATE TABLE t (a INT);",
            '0002_without.sql' => "-- just a comment mentioning idempotent-ddl\nCREATE TABLE t (a INT);",
            '0003_later.sql' => "-- header\n-- @idempotent-ddl\nCREATE TABLE t (a INT);",
        ]);
        [$with, $without, $later] = MigrationFile::discover($dir);
        self::assertTrue($with->idempotentDdl());
        self::assertFalse($without->idempotentDdl());
        self::assertTrue($later->idempotentDdl());
    }
}
