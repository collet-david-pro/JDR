<?php

declare(strict_types=1);

namespace JDR\Tests\Api;

use JDR\Core\Router;
use JDR\Domain\Settings\SecretBox;
use JDR\Mail\Mailer;
use JDR\Tests\Domain\FakeSmtpTransport;

/**
 * /admin/*: access matrix and admin features.
 */
final class AdminApiTest extends ApiTestCase
{
    /**
     * Every route of the application declared with role=admin.
     *
     * @return list<array{0: string, 1: string}>
     */
    private static function adminRoutes(): array
    {
        $router = new Router();
        (require dirname(__DIR__, 3) . '/app/Http/routes.php')($router);
        $routes = (new \ReflectionProperty(Router::class, 'routes'))->getValue($router);
        $out = [];
        foreach ($routes as $route) {
            if (($route['options']['role'] ?? null) !== 'admin') {
                continue;
            }
            $path = (string) preg_replace('/\{[a-z_]+(?::[^}]+)?\}/i', '1', $route['pattern']);
            foreach ($route['methods'] as $method) {
                $out[] = [$method, $path];
            }
        }

        return $out;
    }

    public function testEveryAdminRouteIsRefusedToAnonymousAndUsers(): void
    {
        $routes = self::adminRoutes();
        self::assertGreaterThanOrEqual(18, count($routes));
        foreach ($routes as [, $path]) {
            self::assertStringStartsWith('/admin/', $path);
        }
        $this->createUser('Bob');
        $anonymous = $this->client();
        $anonymous->me();
        $user = $this->client('203.0.113.20');
        $user->login('Bob', self::PASSWORD);
        foreach ($routes as [$method, $path]) {
            $body = $method === 'GET' ? null : [];
            $r = $anonymous->request($method, $path, $body);
            self::assertSame(401, $r->status(), 'anonymous ' . $method . ' ' . $path);
            $r = $user->request($method, $path, $body);
            self::assertSame(403, $r->status(), 'user ' . $method . ' ' . $path);
            self::assertSame('forbidden', self::errorCode($r));
        }
        self::assertSame(0, $this->rows('audit_log'));
    }

    public function testMaintenanceFlagLetsOnlyAdminsThrough(): void
    {
        $this->createUser('Admin', 'admin');
        $this->createUser('Bob');
        $this->setSetting('maintenance', true);

        $user = $this->client('203.0.113.30');
        $user->login('Bob', self::PASSWORD);
        $r = $user->get('/me/storage');
        self::assertSame(503, $r->status());
        self::assertSame('maintenance', self::errorCode($r));

        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        self::assertSame(200, $admin->get('/admin/stats')->status());
        self::assertSame(200, $admin->get('/me/storage')->status());
    }

    public function testStatsAndUsers(): void
    {
        $this->createUser('Admin', 'admin');
        $this->createUser('Bob');
        $this->createUser('Carol', 'user', self::PASSWORD, 'suspended');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);

        $stats = $admin->get('/admin/stats');
        self::assertSame(200, $stats->status(), $stats->body());
        self::assertSame([
            'users' => ['total' => 3, 'active' => 2, 'suspended' => 1, 'admins' => 1],
            'games' => 0, 'maps' => 0, 'storage_bytes' => 0, 'active_sessions' => 0,
        ], $stats->payload()['data']);

        $page = $admin->get('/admin/users?limit=2');
        self::assertCount(2, $page->payload()['data']);
        $cursor = $page->payload()['meta']['next_cursor'];
        self::assertIsString($cursor);
        $rest = $admin->get('/admin/users?limit=2&cursor=' . $cursor);
        self::assertCount(1, $rest->payload()['data']);
        self::assertNull($rest->payload()['meta']['next_cursor']);
        self::assertSame('Carol', $admin->get('/admin/users?status=suspended')->payload()['data'][0]['username']);
        self::assertSame('Bob', $admin->get('/admin/users?q=BOB')->payload()['data'][0]['username']);
        self::assertSame(422, $admin->get('/admin/users?status=weird')->status());

        // Create with a password.
        $created = $admin->post('/admin/users', ['email' => 'dan@example.org', 'username' => 'Dan', 'role' => 'user', 'password' => self::PASSWORD]);
        self::assertSame(201, $created->status(), $created->body());
        self::assertNull($created->payload()['data']['reset_link']);
        // Without password: reset link.
        $noPass = $admin->post('/admin/users', ['email' => 'eve@example.org', 'username' => 'Eve', 'role' => 'admin']);
        self::assertSame(201, $noPass->status());
        self::assertSame('admin', $noPass->payload()['data']['user']['role']);
        self::assertStringStartsWith('http://jdr.test/reset-password/', $noPass->payload()['data']['reset_link']['url']);
        $taken = $admin->post('/admin/users', ['email' => 'dan@example.org', 'username' => 'Dan']);
        self::assertSame(['email' => 'taken', 'username' => 'taken'], $taken->payload()['error']['fields']);
        $eveId = $noPass->payload()['data']['user']['id'];

        // Update.
        $danId = $created->payload()['data']['user']['id'];
        $upd = $admin->patch('/admin/users/' . $danId, ['username' => 'Daniel', 'storage_quota_bytes' => 1048576]);
        self::assertSame(200, $upd->status(), $upd->body());
        self::assertSame('Daniel', $upd->payload()['data']['user']['username']);
        self::assertSame(1048576, $upd->payload()['data']['user']['storage_quota_bytes']);
        $reset = $admin->patch('/admin/users/' . $danId, ['storage_quota_bytes' => null]);
        self::assertNull($reset->payload()['data']['user']['storage_quota_bytes']);
        self::assertSame(422, $admin->patch('/admin/users/' . $danId, ['role' => 'god'])->status());
        self::assertSame(404, $admin->patch('/admin/users/999999', ['username' => 'Ghost'])->status());

        // Self-protection.
        $adminId = $admin->me()['user']['id'];
        self::assertSame('self_action', self::errorCode($admin->post('/admin/users/' . $adminId . '/suspend')));
        self::assertSame('self_action', self::errorCode($admin->patch('/admin/users/' . $adminId, ['role' => 'user'])));
        self::assertSame('self_action', self::errorCode($admin->delete('/admin/users/' . $adminId)));

        // Delete another admin, then a user.
        self::assertSame(204, $admin->delete('/admin/users/' . $eveId)->status());
        self::assertSame(204, $admin->delete('/admin/users/' . $danId)->status());
        self::assertSame(404, $admin->delete('/admin/users/' . $danId)->status());
        self::assertSame(3, $admin->get('/admin/stats')->payload()['data']['users']['total']);

        // Audit trail, newest first.
        $audit = $admin->get('/admin/audit')->payload()['data'];
        $actions = array_column($audit, 'action');
        self::assertSame('user.delete', $actions[0]);
        self::assertContains('user.create', $actions);
        self::assertContains('quota.change', $actions);
        self::assertSame(['id' => $adminId, 'username' => 'Admin'], $audit[0]['user']);
        self::assertSame('203.0.113.10', $audit[0]['ip']);
        self::assertMatchesRegularExpression('/Z$/', $audit[0]['created_at']);
        $paged = $admin->get('/admin/audit?limit=1');
        self::assertCount(1, $paged->payload()['data']);
        self::assertNotNull($paged->payload()['meta']['next_cursor']);
    }

    public function testSettings(): void
    {
        $this->createUser('Admin', 'admin');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);

        $settings = $admin->get('/admin/settings')->payload()['data']['settings'];
        self::assertSame([
            'site_name' => 'JDR',
            'base_url' => '',
            'default_locale' => 'fr',
            'registration_mode' => 'open',
            'default_quota_bytes' => 524288000,
            'max_upload_bytes' => 10485760,
            'max_dimension_px' => 4096,
            'max_total_pixels' => 16777216,
            'max_frames' => 300,
            'max_animation_ms' => 20000,
            'events_retention_hours' => 24,
            'versions_retention' => 30,
            'trash_days' => 30,
            'session_idle_hours' => 12,
            'use_db_sessions' => false,
            'maintenance' => false,
            'smtp' => [
                'host' => '', 'port' => 587, 'encryption' => 'starttls', 'username' => '', 'password_set' => false,
                'from_email' => '', 'from_name' => 'JDR',
            ],
        ], $settings);

        $bad = $admin->patch('/admin/settings', [
            'registration_mode' => 'maybe', 'max_frames' => 0, 'unknown' => 1, 'smtp' => ['port' => 70000, 'nope' => 1],
        ]);
        self::assertSame(422, $bad->status());
        self::assertSame(
            ['unknown' => 'invalid', 'registration_mode' => 'invalid', 'max_frames' => 'invalid', 'smtp.nope' => 'invalid', 'smtp.port' => 'invalid'],
            $bad->payload()['error']['fields'],
        );

        $ok = $admin->patch('/admin/settings', [
            'site_name' => 'Ma table',
            'registration_mode' => 'invite',
            'default_quota_bytes' => 1073741824,
            'smtp' => [
                'host' => 'smtp.example.org', 'port' => 587, 'encryption' => 'starttls', 'username' => 'mailer',
                'password' => 'Smtp-Secret-Value', 'from_email' => 'jdr@example.org', 'from_name' => 'JDR',
            ],
        ]);
        self::assertSame(200, $ok->status(), $ok->body());
        $view = $ok->payload()['data']['settings'];
        self::assertSame('Ma table', $view['site_name']);
        self::assertSame('invite', $view['registration_mode']);
        self::assertTrue($view['smtp']['password_set']);
        self::assertStringNotContainsString('Smtp-Secret-Value', $ok->body());
        $stored = (string) $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . " WHERE `key` = 'smtp'");
        self::assertStringNotContainsString('Smtp-Secret-Value', $stored);
        $enc = json_decode($stored, true)['password_enc'];
        self::assertSame('Smtp-Secret-Value', (new SecretBox(str_repeat('0123456789abcdef', 4)))->decrypt($enc));
        // Omitting the password keeps it.
        $admin->patch('/admin/settings', ['smtp' => ['from_name' => 'Table']]);
        self::assertTrue($admin->get('/admin/settings')->payload()['data']['settings']['smtp']['password_set']);
        self::assertTrue($admin->me()['smtp_enabled']);
        self::assertSame('invite', $admin->me()['registration_mode']);
        $audit = $this->db->fetchValue('SELECT `data` FROM ' . $this->db->t('audit_log') . " WHERE `action` = 'settings.update' ORDER BY `id` LIMIT 1");
        self::assertStringContainsString('smtp.password', (string) $audit);
        self::assertStringNotContainsString('Smtp-Secret-Value', (string) $audit);
        // Wrapped form {settings: {...}} is accepted too.
        self::assertSame('Wrapped', $admin->patch('/admin/settings', ['settings' => ['site_name' => 'Wrapped']])->payload()['data']['settings']['site_name']);
    }

    public function testSmtpTestAndForgotByEmail(): void
    {
        $this->createUser('Admin', 'admin');
        $this->createUser('Bob');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        $notConfigured = $admin->post('/admin/settings/smtp-test', ['to' => 'admin@example.org']);
        self::assertFalse($notConfigured->payload()['data']['sent']);

        $admin->patch('/admin/settings', ['smtp' => [
            'host' => 'smtp.example.org', 'port' => 587, 'encryption' => 'starttls', 'username' => 'mailer',
            'password' => 'Smtp-Secret-Value', 'from_email' => 'jdr@example.org',
        ]]);
        $transports = [];
        $mailer = $this->app->container()->get(Mailer::class);
        $mailer->setTransportFactory(static function () use (&$transports): FakeSmtpTransport {
            return $transports[] = new FakeSmtpTransport(FakeSmtpTransport::happyReplies());
        });
        $test = $admin->post('/admin/settings/smtp-test', ['to' => 'admin@example.org']);
        self::assertSame(200, $test->status(), $test->body());
        self::assertTrue($test->payload()['data']['sent']);
        self::assertContains('> AUTH PLAIN [credentials hidden]', $test->payload()['data']['log']);
        self::assertStringNotContainsString('Smtp-Secret-Value', $test->body());
        self::assertStringContainsString(base64_encode("\0mailer\0Smtp-Secret-Value"), $transports[0]->transcript());

        // Forgot password now sends an e-mail with a working link; same answer for unknown e-mails.
        $guest = $this->client('203.0.113.70');
        $guest->me();
        self::assertSame(['mode' => 'email'], $guest->post('/auth/password/forgot', ['email' => 'nobody@example.org'])->payload()['data']);
        self::assertCount(1, $transports);
        self::assertSame(['mode' => 'email'], $guest->post('/auth/password/forgot', ['email' => 'bob@example.org'])->payload()['data']);
        self::assertCount(2, $transports);
        $mail = quoted_printable_decode($transports[1]->transcript());
        self::assertSame(1, preg_match('#http://jdr\.test/reset-password/([A-Za-z0-9._-]+)#', $mail, $m), $mail);
        $ok = $guest->post('/auth/password/reset', ['token' => $m[1], 'password' => 'Brand-New-Pass-77']);
        self::assertSame(200, $ok->status(), $ok->body());
        self::assertSame('Bob', $guest->login('bob', 'Brand-New-Pass-77')['user']['username']);
    }

    public function testInvitationsAdmin(): void
    {
        $this->createUser('Admin', 'admin');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        $created = $admin->post('/admin/invitations', ['email' => 'x@example.org', 'max_uses' => 3, 'expires_in_days' => 2]);
        self::assertSame(201, $created->status());
        $inv = $created->payload()['data']['invitation'];
        self::assertSame(['id', 'email', 'max_uses', 'uses', 'expires_at', 'created_at', 'created_by'], array_keys($inv));
        self::assertSame(3, $inv['max_uses']);
        self::assertSame(0, $inv['uses']);
        self::assertMatchesRegularExpression('/^[A-Z2-9]{20}$/', $created->payload()['data']['code']);
        self::assertSame(422, $admin->post('/admin/invitations', ['max_uses' => 0])->status());
        $list = $admin->get('/admin/invitations')->payload()['data'];
        self::assertCount(1, $list);
        self::assertArrayNotHasKey('code', $list[0]);
        self::assertSame(204, $admin->delete('/admin/invitations/' . $inv['id'])->status());
        self::assertSame(404, $admin->delete('/admin/invitations/' . $inv['id'])->status());
        self::assertSame([], $admin->get('/admin/invitations')->payload()['data']);
    }

    public function testDiagnosticSseAndMigrations(): void
    {
        $this->createUser('Admin', 'admin');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);

        $diag = $admin->get('/admin/diagnostic');
        self::assertSame(200, $diag->status(), $diag->body());
        $checks = $diag->payload()['data']['checks'];
        $ids = array_column($checks, 'id');
        foreach (['php_version', 'mysql_version', 'db_version', 'ext_pdo_mysql', 'routing_mode', 'storage_writable',
            'private_dirs', 'clock_skew', 'disk_free', 'db_size', 'integrity', 'session_save_path'] as $id) {
            self::assertContains($id, $ids);
        }
        foreach ($checks as $check) {
            self::assertSame(['id', 'status', 'value', 'hint_key'], array_keys($check));
            self::assertContains($check['status'], ['ok', 'warn', 'error']);
        }
        $byId = array_column($checks, null, 'id');
        self::assertSame('ok', $byId['php_version']['status']);
        self::assertSame('ok', $byId['storage_writable']['status']);
        self::assertSame('ok', $byId['clock_skew']['status']);

        $sse = $admin->get('/admin/diagnostic/sse');
        self::assertSame(200, $sse->status());
        self::assertSame('text/event-stream; charset=utf-8', $sse->header('Content-Type'));
        self::assertSame(3, substr_count($sse->body(), 'event: ping'));

        $migrations = $admin->get('/admin/migrations')->payload()['data'];
        self::assertSame('0001', $migrations[0]['version']);
        self::assertSame(['version', 'name', 'status', 'applied_at', 'duration_ms', 'checksum_ok'], array_keys($migrations[0]));
        self::assertSame('applied', $migrations[0]['status']);
        self::assertTrue($migrations[0]['checksum_ok']);
    }

    public function testLastAdminProtection(): void
    {
        $this->createUser('Admin', 'admin');
        $other = $this->createUser('Other', 'admin', self::PASSWORD, 'suspended');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        // Demoting a suspended admin is fine (not the last active one).
        self::assertSame(200, $admin->patch('/admin/users/' . $other, ['role' => 'user'])->status());
    }

    public function testRoleChangeRegeneratesTheSession(): void
    {
        $this->createUser('Admin', 'admin');
        $bob = $this->createUser('Bob');
        $client = $this->client('203.0.113.30');
        $client->login('Bob', self::PASSWORD);
        $sid = $client->cookies['jdr_sid'];
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        $admin->patch('/admin/users/' . $bob, ['role' => 'admin']);
        self::assertSame('admin', $client->me()['user']['role']);
        self::assertNotSame($sid, $client->cookies['jdr_sid']);
        self::assertSame(200, $client->get('/admin/stats')->status());
    }
}
