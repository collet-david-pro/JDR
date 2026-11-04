<?php

declare(strict_types=1);

namespace JDR\Tests\Security;

use JDR\Core\App;
use JDR\Core\Router;
use JDR\Tests\Api\ApiTestCase;
use JDR\Tests\Assets\RightsMatrixTest;
use JDR\Tests\Displays\DisplayRightsMatrixTest;
use JDR\Tests\Games\EncountersApiTest;
use JDR\Tests\Games\GameRightsMatrixTest;
use JDR\Tests\Games\MembersApiTest;
use JDR\Tests\MapsP4c\MapThumbnailTest;
use JDR\Tests\MapsP4c\MapTransferTest;
use JDR\Tests\MapsP4c\MapVersionsTest;
use JDR\Tests\MapsP5\MapSceneRightsTest;
use JDR\Tests\MapsP9\ChangeMapTest;
use JDR\Tests\MapsP9\StairsLinksTest;
use JDR\Tests\MapsP9c\TemplatesRightsTest;
use JDR\Tests\Sessions\PresenceTest;
use JDR\Tests\Sessions\SessionRightsMatrixTest;

/**
 * Access control of EVERY API route (docs/securite.md, A01). The routes are read from the application's own
 * router (app/Http/routes.php loads app/Http/routes/*.php). Each one must appear in self::routes() with its access
 * level and either the test class that proves the per-object rights (owner, member, GM...) or a justification.
 * Adding a route without listing it here fails; so does a listed route that no longer exists.
 * Checked here for every route: anonymous => 401 (except the public ones), non-admin => 403 on /admin/**,
 * a signed-in user without a screen cookie => 401 on the screen routes; the declared options match the level.
 */
final class RouteCoverageTest extends ApiTestCase
{
    private const PUBLIC = 'public';
    private const USER = 'user';
    private const ADMIN = 'admin';
    private const DISPLAY = 'display';
    private const TOKEN = 'token';

    private const ADMIN_CHECKED_HERE = 'Role admin: 401 anonymous and 403 non-admin checked by this test.';
    private const OWN_ACCOUNT = 'Acts on the signed-in account only (no object id from another user).';
    private const OWN_LIST = 'Lists or creates for the signed-in user only (games where they are a member).';
    private const SIGNED = 'HMAC-SHA256 signed URL with an expiry (Signer::verifyWithExpiry), no session.';
    private const RESTORE_TOKEN = 'Database restore step: 128-bit restore token compared with hash_equals (DbRestore::step).';

    /**
     * "METHOD /pattern" => [access level, test class proving the object rights, or justification].
     *
     * @return array<string, array{0: string, 1: string}>
     */
    private static function routes(): array
    {
        return [
            'GET /health' => [self::PUBLIC, 'Supervision: no data.'],
            'GET /version' => [self::PUBLIC, 'Supervision: no data.'],
            'GET /auth/me' => [self::PUBLIC, 'Anonymous visitor: user null plus the CSRF token.'],
            'POST /auth/register' => [self::PUBLIC, 'Account creation: rate register, registration mode in the settings.'],
            'POST /auth/login' => [self::PUBLIC, 'Login: rate login, block after 6 failures, identical failures.'],
            'POST /auth/logout' => [self::PUBLIC, 'No effect without a session.'],
            'POST /auth/password/forgot' => [self::PUBLIC, 'Rate forgot, same answer whether the account exists or not, e-mail sent after the response.'],
            'POST /auth/password/reset' => [self::PUBLIC, 'Single-use 256-bit token, stored hashed, expires.'],
            'GET /invitations/{code}' => [self::PUBLIC, '20-character random code (~99 bits); only says valid or not.'],
            'PATCH /me' => [self::USER, self::OWN_ACCOUNT],
            'DELETE /me' => [self::USER, self::OWN_ACCOUNT],
            'POST /me/password' => [self::USER, self::OWN_ACCOUNT],
            'PUT /me/prefs/{key}' => [self::USER, self::OWN_ACCOUNT],
            'GET /me/devices' => [self::USER, self::OWN_ACCOUNT],
            'DELETE /me/devices/{id:\\d+}' => [self::USER, self::OWN_ACCOUNT],
            'GET /me/storage' => [self::USER, self::OWN_ACCOUNT],
            'GET /me/export' => [self::USER, self::OWN_ACCOUNT],
            'GET /admin/stats' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/users' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/users' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'PATCH /admin/users/{id:\\d+}' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'DELETE /admin/users/{id:\\d+}' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/users/{id:\\d+}/suspend' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/users/{id:\\d+}/unsuspend' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/users/{id:\\d+}/reset-link' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/settings' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'PATCH /admin/settings' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/settings/smtp-test' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/invitations' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/invitations' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'DELETE /admin/invitations/{id:\\d+}' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/diagnostic' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/diagnostic/sse' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/audit' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/migrations' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/update' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'PATCH /admin/update' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/update/backup' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'DELETE /admin/update/backup' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/update/check' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/update/install-latest' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/update/uploads' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'PUT /admin/update/uploads/{upload:[0-9a-f]+}' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/update/uploads/{upload:[0-9a-f]+}/complete' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'DELETE /admin/update/pending' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/update/start' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /admin/backup' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/backup/jobs' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/backup/uploads' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'PUT /admin/backup/uploads/{upload:[0-9a-f]+}' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/backup/restore/db' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/backup/restore/db/{id:[0-9a-f]+}/step' => [self::TOKEN, self::RESTORE_TOKEN],
            'POST /admin/backup/restore/assets' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/integrity/check' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/integrity/fix' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'POST /admin/base-pack/install' => [self::ADMIN, self::ADMIN_CHECKED_HERE],
            'GET /assets/limits' => [self::USER, self::OWN_ACCOUNT],
            'GET /assets' => [self::USER, RightsMatrixTest::class],
            'POST /assets' => [self::USER, RightsMatrixTest::class],
            'GET /assets/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'PATCH /assets/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'DELETE /assets/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'GET /assets/{id:\\d+}/usages' => [self::USER, RightsMatrixTest::class],
            'PUT /assets/{id:\\d+}/favorite' => [self::USER, RightsMatrixTest::class],
            'DELETE /assets/{id:\\d+}/favorite' => [self::USER, RightsMatrixTest::class],
            'GET /files/{uuid:[0-9a-f-]+}' => [self::PUBLIC, self::SIGNED],
            'GET /asset-categories' => [self::USER, RightsMatrixTest::class],
            'POST /asset-categories' => [self::USER, RightsMatrixTest::class],
            'PATCH /asset-categories/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'DELETE /asset-categories/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'GET /asset-tags' => [self::USER, RightsMatrixTest::class],
            'POST /asset-tags' => [self::USER, RightsMatrixTest::class],
            'DELETE /asset-tags/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'POST /asset-packs/import' => [self::USER, RightsMatrixTest::class],
            'POST /asset-packs/export' => [self::USER, RightsMatrixTest::class],
            'GET /jobs/{id:\\d+}' => [self::USER, RightsMatrixTest::class],
            'POST /jobs/{id:\\d+}/step' => [self::USER, RightsMatrixTest::class],
            'POST /jobs/{id:\\d+}/cancel' => [self::USER, RightsMatrixTest::class],
            'GET /jobs/{id:\\d+}/download' => [self::USER, RightsMatrixTest::class],
            'GET /games' => [self::USER, self::OWN_LIST],
            'POST /games' => [self::USER, self::OWN_LIST],
            'GET /games/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'PATCH /games/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'DELETE /games/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'POST /games/{id:\\d+}/archive' => [self::USER, GameRightsMatrixTest::class],
            'POST /games/{id:\\d+}/restore' => [self::USER, GameRightsMatrixTest::class],
            'GET /games/{id:\\d+}/members' => [self::USER, MembersApiTest::class],
            'POST /games/{id:\\d+}/members' => [self::USER, MembersApiTest::class],
            'PATCH /games/{id:\\d+}/members/{userId:\\d+}' => [self::USER, MembersApiTest::class],
            'DELETE /games/{id:\\d+}/members/{userId:\\d+}' => [self::USER, MembersApiTest::class],
            'GET /games/{id:\\d+}/tokens' => [self::USER, GameRightsMatrixTest::class],
            'POST /games/{id:\\d+}/tokens' => [self::USER, GameRightsMatrixTest::class],
            'GET /tokens/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'PATCH /tokens/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'DELETE /tokens/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'GET /games/{id:\\d+}/encounters' => [self::USER, EncountersApiTest::class],
            'POST /games/{id:\\d+}/encounters' => [self::USER, EncountersApiTest::class],
            'PATCH /encounters/{id:\\d+}' => [self::USER, EncountersApiTest::class],
            'DELETE /encounters/{id:\\d+}' => [self::USER, EncountersApiTest::class],
            'POST /encounters/{id:\\d+}/place' => [self::USER, EncountersApiTest::class],
            'GET /games/{id:\\d+}/maps' => [self::USER, GameRightsMatrixTest::class],
            'POST /games/{id:\\d+}/maps' => [self::USER, GameRightsMatrixTest::class],
            'GET /maps/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'PATCH /maps/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'DELETE /maps/{id:\\d+}' => [self::USER, GameRightsMatrixTest::class],
            'POST /maps/{id:\\d+}/restore' => [self::USER, GameRightsMatrixTest::class],
            'POST /maps/{id:\\d+}/duplicate' => [self::USER, TemplatesRightsTest::class],
            'POST /maps/{id:\\d+}/ops' => [self::USER, MapSceneRightsTest::class],
            'GET /maps/{id:\\d+}/chunks' => [self::USER, TemplatesRightsTest::class],
            'GET /maps/{id:\\d+}/versions' => [self::USER, MapVersionsTest::class],
            'POST /maps/{id:\\d+}/versions' => [self::USER, MapVersionsTest::class],
            'POST /maps/{id:\\d+}/versions/{vid:\\d+}/restore' => [self::USER, MapVersionsTest::class],
            'GET /maps/{id:\\d+}/export' => [self::USER, MapTransferTest::class],
            'POST /games/{id:\\d+}/maps/import' => [self::USER, MapTransferTest::class],
            'PUT /maps/{id:\\d+}/thumbnail' => [self::USER, MapThumbnailTest::class],
            'GET /map-thumbs/{id:\\d+}' => [self::PUBLIC, self::SIGNED],
            'GET /maps/{id:\\d+}/fog' => [self::USER, MapSceneRightsTest::class],
            'DELETE /maps/{id:\\d+}/fog' => [self::USER, MapSceneRightsTest::class],
            'GET /maps/{id:\\d+}/objects' => [self::USER, MapSceneRightsTest::class],
            'GET /procgen/pack' => [self::USER, 'Static generation tables, same for every user.'],
            'GET /maps/{id:\\d+}/links' => [self::USER, StairsLinksTest::class],
            'GET /templates' => [self::USER, TemplatesRightsTest::class],
            'POST /maps/{id:\\d+}/save-as-template' => [self::USER, TemplatesRightsTest::class],
            'POST /templates/{id:\\d+}/instantiate' => [self::USER, TemplatesRightsTest::class],
            'DELETE /templates/{id:\\d+}' => [self::USER, TemplatesRightsTest::class],
            'GET /events' => [self::USER, LeakTest::class],
            'GET /stream' => [self::USER, LeakTest::class],
            'POST /games/{id:\\d+}/sessions' => [self::USER, SessionRightsMatrixTest::class],
            'GET /games/{id:\\d+}/sessions' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/join' => [self::USER, 'Join by code: rate join (10 per minute), the code is the invitation.'],
            'GET /sessions/{id:\\d+}' => [self::USER, SessionRightsMatrixTest::class],
            'PATCH /sessions/{id:\\d+}' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/leave' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/start' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/pause' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/resume' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/end' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/regenerate-code' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/kick' => [self::USER, SessionRightsMatrixTest::class],
            'PUT /sessions/{id:\\d+}/assignments/{tokenId:\\d+}' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/ready' => [self::USER, SessionRightsMatrixTest::class],
            'POST /sessions/{id:\\d+}/change-map' => [self::USER, ChangeMapTest::class],
            'POST /sessions/{id:\\d+}/actions' => [self::USER, SessionRightsMatrixTest::class],
            'GET /sessions/{id:\\d+}/preload' => [self::USER, LeakTest::class],
            'GET /sessions/{id:\\d+}/snapshot' => [self::USER, LeakTest::class],
            'POST /presence' => [self::USER, PresenceTest::class],
            'POST /sessions/{id:\\d+}/displays' => [self::USER, DisplayRightsMatrixTest::class],
            'GET /sessions/{id:\\d+}/displays' => [self::USER, DisplayRightsMatrixTest::class],
            'PATCH /displays/{id:\\d+}' => [self::USER, DisplayRightsMatrixTest::class],
            'DELETE /displays/{id:\\d+}' => [self::USER, DisplayRightsMatrixTest::class],
            'POST /displays/{id:\\d+}/regenerate-code' => [self::USER, DisplayRightsMatrixTest::class],
            'POST /display/pair' => [self::PUBLIC, 'Screen pairing: rate pair, 6-digit code with a short life.'],
            'GET /display/me' => [self::DISPLAY, DisplayRightsMatrixTest::class],
            'PATCH /display/me' => [self::DISPLAY, DisplayRightsMatrixTest::class],
            'POST /display/unpair' => [self::DISPLAY, DisplayRightsMatrixTest::class],
        ];
    }

    public function testEveryRouteIsListedWithAJustifiedCoverage(): void
    {
        $listed = self::routes();
        $actual = [];
        foreach ($this->appRoutes() as $route) {
            $key = implode(',', $route['methods']) . ' ' . $route['pattern'];
            $actual[$key] = true;
            self::assertArrayHasKey($key, $listed, 'New route without an access review: add it to RouteCoverageTest::routes().');
            [$level, $coverage] = $listed[$key];
            $options = $route['options'];
            $auth = ($options['auth'] ?? false) === true;
            $role = $options['role'] ?? null;
            $display = $options['display'] ?? null;
            match ($level) {
                self::PUBLIC => self::assertTrue(!$auth && $role === null && $display !== 'only', $key . ' is declared public'),
                self::USER => self::assertTrue($auth && $role === null, $key . ' must have auth=true'),
                self::ADMIN => self::assertSame('admin', $role, $key . ' must have role=admin'),
                self::DISPLAY => self::assertSame('only', $display, $key . ' must have display=only'),
                self::TOKEN => self::assertTrue(!$auth && $role === null && ($options['csrf'] ?? true) === false, $key),
            };
            if (str_starts_with($route['pattern'], '/admin/')) {
                self::assertContains($level, [self::ADMIN, self::TOKEN], $key . ': every /admin/** route is for administrators');
            }
            if (str_starts_with($coverage, 'JDR\\Tests\\')) {
                self::assertTrue(class_exists($coverage), $key . ': unknown test class ' . $coverage);
            } else {
                self::assertGreaterThanOrEqual(20, strlen($coverage), $key . ': the exemption needs a justification');
            }
        }
        self::assertSame([], array_keys(array_diff_key($listed, $actual)), 'Listed routes that no longer exist');
    }

    public function testAnonymousAndNonAdminAreRefusedEverywhere(): void
    {
        $this->createUser('Bob');
        $bob = $this->client('203.0.113.21');
        $bob->login('Bob', self::PASSWORD);
        $anonymous = $this->client('203.0.113.22');
        $checked = 0;
        foreach ($this->appRoutes() as $route) {
            $key = implode(',', $route['methods']) . ' ' . $route['pattern'];
            $level = self::routes()[$key][0] ?? null;
            if ($level === null || $level === self::PUBLIC || $level === self::TOKEN) {
                continue;
            }
            $method = $route['methods'][0];
            $path = self::concretePath($route['pattern']);
            $body = $method === 'GET' ? null : [];
            $r = $anonymous->request($method, $path, $body);
            self::assertSame(401, $r->status(), 'anonymous ' . $key . ' ' . $r->body());
            if ($level === self::ADMIN) {
                $r = $bob->request($method, $path, $body);
                self::assertSame(403, $r->status(), 'non-admin ' . $key . ' ' . $r->body());
            } elseif ($level === self::DISPLAY) {
                $r = $bob->request($method, $path, $body);
                self::assertSame(401, $r->status(), 'user without a screen cookie ' . $key);
                self::assertSame('display_unpaired', self::errorCode($r));
            }
            $checked++;
        }
        self::assertGreaterThan(100, $checked);
    }

    public function testTokenRoutesRefuseAMissingOrWrongToken(): void
    {
        $anonymous = $this->client('203.0.113.23');
        $step = '/admin/backup/restore/db/' . bin2hex(random_bytes(8)) . '/step';
        self::assertSame(422, $anonymous->post($step, [])->status(), 'no token');
        self::assertSame(404, $anonymous->post($step, ['token' => bin2hex(random_bytes(16))])->status(), 'wrong token');

        $uuid = '0f0e0d0c-0b0a-4908-8706-050403020100';
        foreach (['/files/' . $uuid, '/files/' . $uuid . '?t=original&e=9999999999&s=forged', '/map-thumbs/1', '/map-thumbs/1?v=a&e=9999999999&s=forged'] as $path) {
            $status = $anonymous->get($path)->status();
            self::assertContains($status, [403, 404], $path);
        }
    }

    public function testSecretsAreComparedInConstantTime(): void
    {
        $root = dirname(__DIR__, 3);
        foreach ([
            'app/Domain/Backup/DbRestore.php', // restore token
            'app/Core/Signer.php', // signed URLs (files, map thumbnails)
            'app/Middleware/Csrf.php', // CSRF header
            'app/Domain/Auth/RememberMe.php', // "remember me" validator
            'app/Domain/Displays/DisplayDevice.php', // screen cookie
            'app/Domain/Update/PreUpdateBackup.php', // pre-update backup download
            'app/Core/Cron.php', // cron key
        ] as $file) {
            self::assertStringContainsString('hash_equals(', (string) file_get_contents($root . '/' . $file), $file);
        }
    }

    /**
     * @return list<array{methods: list<string>, pattern: string, options: array<string, mixed>}>
     */
    private function appRoutes(): array
    {
        $router = (new \ReflectionProperty(App::class, 'router'))->getValue($this->app);
        self::assertInstanceOf(Router::class, $router);
        /** @var list<array{methods: list<string>, pattern: string, options: array<string, mixed>}> $routes */
        $routes = (new \ReflectionProperty(Router::class, 'routes'))->getValue($router);
        self::assertNotEmpty($routes);

        return $routes;
    }

    private static function concretePath(string $pattern): string
    {
        return (string) preg_replace_callback(
            '#\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^{}/]+))?\}#',
            static fn (array $m): string => match (true) {
                str_contains($m[2] ?? '', '\d') => '1',
                str_contains($m[2] ?? '', 'a-f') => 'ab12',
                default => 'x1',
            },
            $pattern,
        );
    }
}
