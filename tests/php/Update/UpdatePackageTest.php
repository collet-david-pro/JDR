<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Update\UpdateChecker;
use JDR\Domain\Update\UpdateException;
use JDR\Domain\Update\UpdatePackage;
use JDR\Domain\Update\UpdateStorage;
use JDR\Install\HttpResult;
use JDR\Tests\Api\ApiTestCase;

final class UpdatePackageTest extends ApiTestCase
{
    private string $install;
    private string $work;
    private UpdateStorage $storage;

    protected function setUp(): void
    {
        parent::setUp();
        Fixture::markRealMigrationsApplied($this->db);
        $this->install = Fixture::install(Fixture::oldFiles() + Fixture::realMigrations());
        $this->work = $this->install . '/storage/work';
        mkdir($this->work);
        $this->storage = UpdateStorage::for($this->install, $this->install . '/storage');
    }

    protected function tearDown(): void
    {
        Fixture::remove($this->install);
    }

    /**
     * @return array<string, string>
     */
    private static function release(): array
    {
        return Fixture::newFiles() + Fixture::realMigrations() + ['migrations/0005_probe.sql' => "SELECT 1;\n"];
    }

    private function package(?FakeReleaseHttp $http = null): UpdatePackage
    {
        $clock = new Clock();
        $checker = new UpdateChecker(new Settings($this->db, $clock), $clock, $http ?? new FakeReleaseHttp(), '0.1.0');

        return new UpdatePackage($this->storage, $checker, $this->db, $clock, '0.1.0');
    }

    private function refused(string $zip, string $code, ?FakeReleaseHttp $http = null): UpdateException
    {
        try {
            $this->package($http)->accept($zip, 1);
        } catch (UpdateException $e) {
            self::assertSame($code, $e->errorCode(), $e->getMessage() . ' ' . json_encode($e->fields()));
            self::assertSame(['index.php', 'update.php'], array_values(array_intersect(['index.php', 'update.php'], array_keys(Fixture::snapshot($this->install)))));
            self::assertNull($this->package()->pending());

            return $e;
        }
        self::fail('Archive accepted, expected ' . $code);
    }

    public function testValidPackageSummary(): void
    {
        $zip = Fixture::zip($this->work, self::release(), '0.2.0');
        $before = Fixture::snapshot($this->install);
        $summary = $this->package()->accept($zip, 7);
        self::assertSame($before, Fixture::snapshot($this->install), 'validation writes nothing in the code');
        self::assertFileDoesNotExist($zip, 'moved into storage/updates');
        self::assertSame('0.2.0', $summary['version']);
        self::assertSame('0.1.0', $summary['current']);
        self::assertSame('unverified', $summary['authenticity']);
        self::assertSame(['added' => 2, 'changed' => 5, 'removed' => 1, 'unchanged' => 6], $summary['files']);
        self::assertSame(['app/New/Added.php', 'migrations/0005_probe.sql'], $summary['changes']['added']);
        self::assertSame(['app/Old/Gone.php'], $summary['changes']['removed']);
        self::assertSame(['0005_probe.sql'], $summary['migrations']);
        self::assertSame(['unverified'], array_column($summary['warnings'], 'code'));
        self::assertSame($summary, $this->package()->pending());
        self::assertFileExists($this->storage->runDir($summary['id']) . '/package.zip');

        // A second upload replaces the first one.
        $second = $this->package()->accept(Fixture::zip($this->work, self::release(), '0.2.0'), 7);
        self::assertSame([$second['id']], $this->storage->ids());
    }

    public function testCommonFolderIsTolerated(): void
    {
        $summary = $this->package()->accept(Fixture::zip($this->work, self::release(), '0.2.0', null, 'jdr-v0.2.0/'), 1);
        self::assertSame(2, $summary['files']['added']);
    }

    public function testUnsafeOrForbiddenPaths(): void
    {
        $release = self::release();
        foreach ([
            'config.php' => ['config.php' => '<?php return [];'],
            'install.php' => ['install.php' => '<?php'],
            'storage' => ['storage/x.txt' => 'x'],
            'outside the list' => ['docs/readme.md' => 'x'],
            'git' => ['app/.git/config' => 'x'],
        ] as $label => $extra) {
            $e = $this->refused(Fixture::zip($this->work, $release + $extra, '0.2.0'), 'update.unsafe_path');
            self::assertSame(array_key_first($extra), $e->fields()['path'] ?? null, $label);
        }
        $zip = Fixture::zip($this->work, $release + ['zz/evil.php' => 'x'], '0.2.0');
        Fixture::renameEntry($zip, 'zz/evil.php', '../evil.php');
        $this->refused($zip, 'update.unsafe_path');
        $zip = Fixture::zip($this->work, $release + ['xapp/x.php' => 'x'], '0.2.0');
        Fixture::renameEntry($zip, 'xapp/x.php', '/app/x.php');
        $this->refused($zip, 'update.unsafe_path');
        $zip = Fixture::zip($this->work, $release, '0.2.0');
        Fixture::markSymlink($zip, 'app/New/Added.php');
        $this->refused($zip, 'update.unsafe_path');
        $this->refused($this->work . '/missing.zip', 'update.invalid_zip');
        file_put_contents($this->work . '/garbage.zip', str_repeat('x', 500));
        $this->refused($this->work . '/garbage.zip', 'update.invalid_zip');
    }

    public function testManifestChecks(): void
    {
        $release = self::release();
        $this->refused(Fixture::zip($this->work, $release, '0.2.0', null, '', false), 'update.missing_manifest');
        $this->refused(Fixture::zip($this->work, $release, 'not-semver'), 'update.missing_manifest');
        $tampered = $release;
        $tampered['app/Changed.php'] = "<?php // tampered\n";
        $e = $this->refused(Fixture::zip($this->work, $tampered, '0.2.0', $release), 'update.file_hash');
        self::assertSame(['path' => 'app/Changed.php', 'reason' => 'mismatch'], $e->fields());
        $e = $this->refused(Fixture::zip($this->work, $release + ['app/Extra.php' => 'x'], '0.2.0', $release), 'update.file_hash');
        self::assertSame('unlisted', $e->fields()['reason']);
        $e = $this->refused(Fixture::zip($this->work, $release, '0.2.0', $release + ['app/Missing.php' => 'x']), 'update.file_hash');
        self::assertSame(['path' => 'app/Missing.php', 'reason' => 'missing'], $e->fields());
        // install.php and storage/ listed in a full manifest are not required in the update archive.
        $this->package()->accept(Fixture::zip($this->work, $release, '0.2.0', $release + ['install.php' => 'x', 'storage/.htaccess' => 'y']), 1);
        self::assertNotNull($this->package()->pending());
    }

    public function testVersionMustBeNewer(): void
    {
        $this->refused(Fixture::zip($this->work, self::release(), '0.1.0'), 'update.not_newer');
        $this->refused(Fixture::zip($this->work, self::release(), '0.0.9'), 'update.not_newer');
        $this->refused(Fixture::zip($this->work, self::release(), '0.1.0-rc.1'), 'update.not_newer');
        $summary = $this->package()->accept(Fixture::zip($this->work, self::release(), '0.3.0'), 1);
        self::assertContains('version_jump', array_column($summary['warnings'], 'code'));
    }

    public function testOfficialHash(): void
    {
        $zip = Fixture::zip($this->work, self::release(), '0.2.0');
        $sha = (string) hash_file('sha256', $zip);
        $http = static fn (string $sum): FakeReleaseHttp => new FakeReleaseHttp([
            UpdateChecker::apiUrl() => FakeReleaseHttp::releases([FakeReleaseHttp::release('v0.2.0')]),
            FakeReleaseHttp::sumsUrl('v0.2.0') => new HttpResult(200, $sum . "  jdr-update-v0.2.0.zip\n"),
        ]);
        $e = $this->refused($zip, 'update.hash_mismatch', $http(str_repeat('c', 64)));
        self::assertSame($sha, $e->fields()['actual']);
        $this->db->execute('DELETE FROM ' . $this->db->t('settings') . " WHERE `key` = 'update_check'");
        $summary = $this->package($http($sha))->accept($zip, 1);
        self::assertSame('verified', $summary['authenticity']);
        self::assertSame([], $summary['warnings']);
    }
}
