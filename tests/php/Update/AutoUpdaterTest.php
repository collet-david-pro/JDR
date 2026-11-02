<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Clock;
use JDR\Core\Logger;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Update\AutoUpdater;
use JDR\Domain\Update\UpdateChecker;
use JDR\Domain\Update\UpdatePackage;
use JDR\Domain\Update\UpdateRunner;
use JDR\Domain\Update\UpdateStorage;
use JDR\Tests\Api\ApiTestCase;

/**
 * Automatic update on a temporary installation: fake GitHub, real runner, test database.
 */
final class AutoUpdaterTest extends ApiTestCase
{
    private const PROBE = "CREATE TABLE `{{prefix}}update_probe` (`id` INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;\n";
    private const BASE = 'https://github.com/' . UpdateChecker::REPOSITORY . '/releases/download/v0.2.0/';

    private string $install;
    private UpdateStorage $storage;
    private string $zip;
    private FakeReleaseHttp $http;
    private ?FakeReleaseDownloader $downloader = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->db->pdo()->exec('DROP TABLE IF EXISTS ' . $this->db->t('update_probe'));
        $this->db->execute('DELETE FROM ' . $this->db->t('schema_migrations') . " WHERE `version` >= '0007'");
        Fixture::markRealMigrationsApplied($this->db);
        $this->createUser('Keeper', 'admin');
        $this->settings()->set('app_version', '0.1.0');
        $this->install = Fixture::install(Fixture::oldFiles() + Fixture::realMigrations());
        $this->storage = UpdateStorage::for($this->install, $this->install . '/storage');
    }

    protected function tearDown(): void
    {
        Fixture::remove($this->install);
        $this->db->pdo()->exec('DROP TABLE IF EXISTS ' . $this->db->t('update_probe'));
    }

    private function settings(): Settings
    {
        return new Settings($this->db, new Clock());
    }

    /**
     * @param string|null $sha official hash in SHA256SUMS (null: no SHA256SUMS published), '' = the real one
     */
    private function publish(string $migration = self::PROBE, ?string $sha = '', string $base = self::BASE): void
    {
        $files = Fixture::newFiles() + Fixture::realMigrations() + ['migrations/0007_probe.sql' => $migration];
        $this->zip = Fixture::zip($this->install . '/storage', $files, '0.2.0');
        $name = 'jdr-update-v0.2.0.zip';
        $assets = [['name' => $name, 'browser_download_url' => $base . $name, 'size' => (int) filesize($this->zip)]];
        $responses = [];
        if ($sha !== null) {
            $assets[] = ['name' => 'SHA256SUMS', 'browser_download_url' => $base . 'SHA256SUMS'];
            $responses[$base . 'SHA256SUMS'] = new \JDR\Install\HttpResult(200, ($sha !== '' ? $sha : hash_file('sha256', $this->zip)) . '  ' . $name . "\n");
        }
        $responses[UpdateChecker::apiUrl()] = FakeReleaseHttp::releases([[
            'tag_name' => 'v0.2.0', 'name' => 'v0.2.0', 'draft' => false, 'prerelease' => false,
            'published_at' => '2026-11-03T10:00:00Z', 'body' => '', 'html_url' => 'https://github.com/x', 'assets' => $assets,
        ]]);
        $this->http = new FakeReleaseHttp($responses);
        $this->downloader = new FakeReleaseDownloader($this->zip);
    }

    /** One fresh object graph per call, like one request each. */
    private function auto(string $current = '0.1.0'): AutoUpdater
    {
        $clock = new Clock();
        $settings = $this->settings();
        $checker = new UpdateChecker($settings, $clock, $this->http ?? new FakeReleaseHttp(), $current);
        $packages = new UpdatePackage($this->storage, $checker, $this->db, $clock, $current);
        $runner = new UpdateRunner($this->storage, $packages, $settings, $this->db, $clock, new AuditLog($this->db, $clock), $current);

        return new AutoUpdater($this->storage, $checker, $packages, $runner, $settings, $this->db, $clock, new AuditLog($this->db, $clock), Logger::discard(), $this->downloader);
    }

    private function installedVersion(): string
    {
        return (string) json_decode((string) file_get_contents($this->install . '/manifest.json'), true)['version'];
    }

    public function testInstallsTheNewReleaseWithoutAnyone(): void
    {
        $this->publish();
        self::assertSame('done', $this->auto()->tick());
        self::assertSame('0.2.0', $this->installedVersion());
        self::assertFileExists($this->install . '/app/New/Added.php');
        self::assertSame(1, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('schema_migrations') . " WHERE `version` = '0007' AND `status` = 'applied'"));
        self::assertFalse($this->settings()->bool('maintenance'));
        self::assertFalse(AutoUpdater::runPending($this->storage));
        self::assertSame('0.2.0', $this->auto()->status()['last_done']['version']);
        self::assertSame([self::BASE . 'jdr-update-v0.2.0.zip'], $this->downloader->urls);
    }

    public function testAnInterruptedRunIsResumedByTheNextRequests(): void
    {
        $this->publish();
        self::assertSame('running', $this->auto()->tick(0.0));
        self::assertTrue(AutoUpdater::runPending($this->storage));
        $last = 'running';
        for ($i = 0; $i < 200 && $last === 'running'; $i++) {
            $last = $this->auto()->tick(0.2);
        }
        self::assertSame('done', $last);
        self::assertSame('0.2.0', $this->installedVersion());
    }

    public function testSwitchedOffNothingHappens(): void
    {
        $this->publish();
        $this->auto()->setEnabled(false);
        self::assertSame('off', $this->auto()->tick());
        self::assertSame([], $this->http->requests);
        self::assertSame('0.1.0', $this->installedVersion());
    }

    public function testNeverInADevelopmentCheckout(): void
    {
        $this->publish();
        mkdir($this->install . '/.git');
        self::assertFalse($this->auto()->supported());
        self::assertSame('off', $this->auto()->tick());
        self::assertSame([], $this->downloader->urls);
    }

    public function testWaitsForTheEndOfARunningSession(): void
    {
        $this->publish();
        $this->db->pdo()->exec('SET FOREIGN_KEY_CHECKS = 0');
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('play_sessions') . " (`game_id`, `code`, `state`, `created_at`, `started_at`) VALUES (1, 'ABCD2345', 'running', UTC_TIMESTAMP(), UTC_TIMESTAMP())",
        );
        $this->db->pdo()->exec('SET FOREIGN_KEY_CHECKS = 1');
        self::assertSame('session', $this->auto()->tick());
        self::assertSame([], $this->downloader->urls);
        $this->db->execute('UPDATE ' . $this->db->t('play_sessions') . " SET `started_at` = UTC_TIMESTAMP() - INTERVAL 13 HOUR");
        self::assertSame('done', $this->auto()->tick(), 'a session forgotten for 13 h no longer blocks');
    }

    public function testAnArchiveWithoutOfficialHashIsNeverInstalled(): void
    {
        $this->publish(self::PROBE, null);
        self::assertSame('none', $this->auto()->tick());
        self::assertSame([], $this->downloader->urls);
    }

    public function testAnotherRepositoryIsRefused(): void
    {
        $this->publish(self::PROBE, '', 'https://github.com/someone/else/releases/download/v0.2.0/');
        self::assertSame('none', $this->auto()->tick());
        self::assertSame([], $this->downloader->urls);
    }

    public function testADifferentHashFailsAndIsRetriedLaterThreeTimesAtMost(): void
    {
        $this->publish(self::PROBE, str_repeat('a', 64));
        self::assertSame('failed', $this->auto()->tick());
        self::assertSame('0.1.0', $this->installedVersion());
        self::assertSame('0.2.0', $this->auto()->status()['last_error']['version']);
        self::assertFileDoesNotExist($this->storage->dir() . '/auto-download.zip');
        self::assertSame('wait', $this->auto()->tick(), 'one hour between two attempts');
        self::assertSame(1, $this->rows('audit_log', "`action` = 'update.auto_failed'"));

        for ($i = 2; $i <= AutoUpdater::MAX_ATTEMPTS; $i++) {
            $this->forgetRetryDelay();
            self::assertSame('failed', $this->auto()->tick());
        }
        $this->forgetRetryDelay();
        self::assertSame('none', $this->auto()->tick());
    }

    public function testAFailedDownloadChangesNothing(): void
    {
        $this->publish();
        $this->downloader = new FakeReleaseDownloader(null);
        self::assertSame('failed', $this->auto()->tick());
        self::assertSame('0.1.0', $this->installedVersion());
    }

    public function testAFailedMigrationIsRestoredAndNotTriedAgain(): void
    {
        $this->publish('THIS IS NOT SQL;');
        self::assertSame('failed', $this->auto()->tick());
        self::assertSame('0.1.0', $this->installedVersion());
        self::assertFileExists($this->install . '/app/Old/Gone.php');
        self::assertFalse($this->settings()->bool('maintenance'));
        self::assertFalse(AutoUpdater::runPending($this->storage));
        $this->forgetRetryDelay();
        self::assertSame('none', $this->auto()->tick());
    }

    public function testFilesUploadedByFtpFinishOnTheirOwn(): void
    {
        $files = Fixture::newFiles() + Fixture::realMigrations() + ['migrations/0007_probe.sql' => self::PROBE];
        Fixture::remove($this->install);
        $this->install = Fixture::install($files, '0.2.0');
        $this->storage = UpdateStorage::for($this->install, $this->install . '/storage');
        self::assertSame('done', $this->auto('0.2.0')->tick());
        self::assertSame('0.2.0', $this->settings()->get('app_version'));
    }

    private function forgetRetryDelay(): void
    {
        $file = $this->storage->dir() . '/auto.json';
        $state = json_decode((string) file_get_contents($file), true);
        $state['retry_at'] = 0;
        file_put_contents($file, (string) json_encode($state));
    }
}
