<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\DevServer;
use JDR\Core\PathGuard;
use PHPUnit\Framework\TestCase;

final class PathGuardTest extends TestCase
{
    /**
     * @return iterable<array{string}>
     */
    public static function privatePaths(): iterable
    {
        foreach ([
            '/app/bootstrap.php', '/app/', '/app', '/APP/Core/Db.php', '/%61pp/bootstrap.php',
            '/storage/', '/storage/logs/app-2026-10-20.log', '/migrations/', '/migrations/0001_initial.sql',
            '/i18n/fr.json', '/config.php', '/Config.PHP', '/config.php.', '/config.example.php',
            '/dev/migrate.php', '/tests/php/bootstrap.php', '/frontend/package.json', '/etapes/00-plan.md',
            '/projet.md', '/.git/config', '/.env', '/.htaccess', '/assets/.hidden', '/phpunit.xml',
            '/assets/../config.php', '/foo/evil.php', '/assets/x.phtml', "/a\0b", '/a\\b', '/app./x',
        ] as $path) {
            yield $path => [$path];
        }
    }

    /**
     * @return iterable<array{string}>
     */
    public static function publicPaths(): iterable
    {
        foreach ([
            '/', '/games/12', '/api/v1/health', '/index.php', '/install.php', '/update.php', '/cron.php',
            '/assets/main-abc123.js', '/sw.js', '/manifest.json', '/VERSION', '/.well-known/acme-challenge/x',
            '/application', '/apps/1',
        ] as $path) {
            yield $path => [$path];
        }
    }

    /**
     * @dataProvider privatePaths
     */
    public function testPrivate(string $path): void
    {
        self::assertTrue(PathGuard::isPrivate($path), $path);
    }

    /**
     * @dataProvider publicPaths
     */
    public function testPublic(string $path): void
    {
        self::assertFalse(PathGuard::isPrivate($path), $path);
    }

    public function testDevServerServesOnlyExistingPublicFiles(): void
    {
        $root = JDR_ROOT;
        self::assertFalse(DevServer::shouldServeStatic($root, '/app/bootstrap.php'));
        self::assertFalse(DevServer::shouldServeStatic($root, '/APP/bootstrap.php'));
        self::assertFalse(DevServer::shouldServeStatic($root, '/i18n/fr.json'));
        self::assertFalse(DevServer::shouldServeStatic($root, '/config.example.php'));
        self::assertFalse(DevServer::shouldServeStatic($root, '/index.php?r=/api/v1/health'));
        self::assertFalse(DevServer::shouldServeStatic($root, '/'));
        self::assertFalse(DevServer::shouldServeStatic($root, '/games/12'));
        self::assertTrue(DevServer::shouldServeStatic($root, '/cron.php?key=x'));
    }
}
