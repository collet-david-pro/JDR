<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Domain\Update\PreUpdateBackup;
use JDR\Domain\Update\UpdateStorage;
use PHPUnit\Framework\TestCase;

final class PreUpdateBackupTest extends TestCase
{
    private string $dir;
    private UpdateStorage $storage;
    private PreUpdateBackup $backup;
    private string $file = 'jdr-20261103-101500-v0.2.0.sql.gz';

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/jdr-preupdate-' . bin2hex(random_bytes(4));
        mkdir($this->dir . '/storage/backups', 0755, true);
        $this->storage = UpdateStorage::for($this->dir, $this->dir . '/storage');
        $this->backup = new PreUpdateBackup($this->storage);
        file_put_contents($this->dir . '/storage/backups/' . $this->file, gzencode('-- sql'));
    }

    protected function tearDown(): void
    {
        UpdateStorage::removeTree($this->dir);
    }

    public function testNothingRegisteredNothingOffered(): void
    {
        self::assertNull($this->backup->status(1000));
        $this->backup->register('../../etc/passwd', '0.1.0', '0.2.0', 1000); // not a backup name: ignored
        $this->backup->register('jdr-missing.sql.gz', '0.1.0', '0.2.0', 1000);
        self::assertNull($this->backup->status(1000));
    }

    public function testAManualUpdateBackupLivesAnHour(): void
    {
        $this->backup->register($this->file, '0.1.0', '0.2.0', 1000);
        $status = $this->backup->status(1000 + 3599);
        self::assertSame($this->file, $status['name']);
        self::assertFalse($status['auto']);
        self::assertNull($this->backup->status(1000 + 3600));
        self::assertFileDoesNotExist($this->dir . '/storage/backups/' . $this->file);
    }

    public function testAnAutomaticUpdateBackupLivesSevenDaysOrUntilDiscarded(): void
    {
        $this->backup->register($this->file, '0.1.0', '0.2.0', 1000);
        $this->backup->markAuto();
        self::assertNotNull($this->backup->status(1000 + 6 * 86400));
        self::assertSame(1, $this->backup->purge(1000 + 7 * 86400));
        self::assertFileDoesNotExist($this->dir . '/storage/backups/' . $this->file);

        file_put_contents($this->dir . '/storage/backups/' . $this->file, 'x');
        $this->backup->register($this->file, '0.1.0', '0.2.0', 1000, true);
        $this->backup->discard();
        self::assertNull($this->backup->status(1001));
        self::assertFileDoesNotExist($this->dir . '/storage/backups/' . $this->file);
    }

    public function testDownloadNeedsTheTokenOfTheSessionAndDeletesTheFileOnceSent(): void
    {
        $this->backup->register($this->file, '0.1.0', '0.2.0', time());
        $token = $this->backup->token('csrf-a', $this->file);
        self::assertNull($this->backup->download(time(), 'csrf-b', $token), 'other session');
        self::assertNull($this->backup->download(time(), 'csrf-a', ''), 'no token');
        self::assertNull($this->backup->download(time(), 'csrf-a', 'forged'), 'forged token');

        $response = $this->backup->download(time(), 'csrf-a', $token);
        self::assertNotNull($response);
        self::assertSame('application/gzip', $response->header('Content-Type'));
        self::assertStringContainsString($this->file, (string) $response->header('Content-Disposition'));
        self::assertSame(gzencode('-- sql'), $response->contents());
        self::assertFileExists($this->dir . '/storage/backups/' . $this->file, 'kept until the whole file is sent');
    }
}
