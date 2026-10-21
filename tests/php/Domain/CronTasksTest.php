<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Core\App;
use JDR\Core\Config;
use JDR\Core\Cron;
use JDR\Core\Logger;
use JDR\Migrate\Runner;
use JDR\Tests\Support\DbTestCase;

final class CronTasksTest extends DbTestCase
{
    public function testHousekeepingTasksRun(): void
    {
        self::dropTestTables();
        $db = self::newDb();
        (new Runner($db, self::migrationsDir()))->runAll();
        $app = App::create(self::projectRoot(), new Config(['cron_key' => 'k', 'app_secret' => str_repeat('s', 64), 'db' => self::dbConfig()]), Logger::discard());
        $cron = $app->container()->get(Cron::class);

        self::assertSame(
            ['rate_limits', 'login_attempts', 'password_resets', 'assets_tmp', 'assets_job_files', 'assets_trash', 'games_trash'],
            $cron->runTasks(5.0),
        );
        self::assertSame(204, $cron->run('k'));
    }
}
