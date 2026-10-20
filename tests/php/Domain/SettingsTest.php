<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

final class SettingsTest extends DbTestCase
{
    public static function setUpBeforeClass(): void
    {
        self::dropTestTables();
        $dir = self::makeMigrationsDir([
            '0001_initial.sql' => (string) file_get_contents(self::migrationsDir() . '/0001_initial.sql'),
        ]);
        try {
            (new Runner(self::newDb(), $dir))->runAll();
        } finally {
            self::removeDir($dir);
        }
    }

    public function testDefaultsWithoutRowsThenStoredValues(): void
    {
        self::truncateTestTables();
        $settings = new Settings(self::newDb(), new Clock());
        self::assertSame(524288000, $settings->int('default_quota_bytes'));
        self::assertSame(10485760, $settings->int('max_upload_bytes'));
        self::assertSame(4096, $settings->int('max_dimension_px'));
        self::assertSame(16777216, $settings->int('max_total_pixels'));
        self::assertSame(300, $settings->int('max_frames'));
        self::assertSame(20000, $settings->int('max_animation_ms'));
        self::assertSame(24, $settings->int('events_retention_hours'));
        self::assertSame(30, $settings->int('versions_retention'));
        self::assertSame(30, $settings->int('trash_days'));
        self::assertSame(12, $settings->int('session_idle_hours'));
        self::assertSame('open', $settings->registrationMode());
        self::assertSame('fr', $settings->string('default_locale'));
        self::assertFalse($settings->bool('use_db_sessions'));
        self::assertFalse($settings->bool('maintenance'));
        self::assertFalse($settings->smtpEnabled());
        self::assertNull($settings->get('unknown_key'));

        $settings->setMany(['registration_mode' => 'invite', 'max_frames' => 12, 'smtp' => ['host' => 'h', 'from_email' => 'a@b.c', 'port' => '25']]);
        $fresh = new Settings(self::newDb(), new Clock());
        self::assertSame('invite', $fresh->registrationMode());
        self::assertSame(12, $fresh->int('max_frames'));
        self::assertTrue($fresh->smtpEnabled());
        self::assertSame(25, $fresh->smtp()['port']);
        self::assertSame('starttls', $fresh->smtp()['encryption']);
        $fresh->set('registration_mode', 'bogus');
        self::assertSame('open', $fresh->registrationMode(), 'unknown mode falls back to open');
    }
}
