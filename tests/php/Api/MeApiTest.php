<?php

declare(strict_types=1);

namespace JDR\Tests\Api;

use JDR\Domain\Auth\RememberMe;

/**
 * /me/*: profile, password, preferences, devices, storage, export, account deletion.
 */
final class MeApiTest extends ApiTestCase
{
    public function testEveryMeRouteNeedsAuthentication(): void
    {
        $client = $this->client();
        $client->me();
        $routes = [
            ['PATCH', '/me'], ['DELETE', '/me'], ['POST', '/me/password'], ['PUT', '/me/prefs/theme_scheme'],
            ['GET', '/me/devices'], ['DELETE', '/me/devices/1'], ['GET', '/me/storage'], ['GET', '/me/export'],
        ];
        foreach ($routes as [$method, $path]) {
            $response = $client->request($method, $path, $method === 'GET' ? null : []);
            self::assertSame(401, $response->status(), $method . ' ' . $path);
            self::assertSame('unauthenticated', self::errorCode($response));
        }
    }

    public function testUpdateProfile(): void
    {
        $this->createUser('Bob');
        $this->createUser('Carol');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD);

        $ok = $client->patch('/me', ['username' => 'Bobby', 'locale' => 'fr']);
        self::assertSame(200, $ok->status(), $ok->body());
        self::assertSame('Bobby', $ok->payload()['data']['user']['username']);

        $taken = $client->patch('/me', ['username' => 'carol']);
        self::assertSame(['username' => 'taken'], $taken->payload()['error']['fields']);
        $badLocale = $client->patch('/me', ['locale' => 'xx']);
        self::assertSame(['locale' => 'invalid'], $badLocale->payload()['error']['fields']);

        $noPassword = $client->patch('/me', ['email' => 'new@example.org']);
        self::assertSame(['current_password' => 'required'], $noPassword->payload()['error']['fields']);
        $wrong = $client->patch('/me', ['email' => 'new@example.org', 'current_password' => 'nope-nope-nope']);
        self::assertSame(['current_password' => 'wrong_password'], $wrong->payload()['error']['fields']);
        $email = $client->patch('/me', ['email' => 'New@Example.org', 'current_password' => self::PASSWORD]);
        self::assertSame(200, $email->status());
        self::assertSame('new@example.org', $email->payload()['data']['user']['email']);
        self::assertNull($email->payload()['data']['user']['email_verified_at']);
    }

    public function testChangePasswordRevokesOtherSessionsAndDevices(): void
    {
        $this->createUser('Bob');
        $laptop = $this->client('203.0.113.1');
        $laptop->login('Bob', self::PASSWORD, true);
        $phone = $this->client('203.0.113.2');
        $phone->login('Bob', self::PASSWORD, true);
        self::assertSame(2, $this->rows('remember_tokens'));

        $wrong = $laptop->post('/me/password', ['current_password' => 'bad-bad-bad', 'new_password' => 'Another-Pass-2026']);
        self::assertSame(['current_password' => 'wrong_password'], $wrong->payload()['error']['fields']);
        $weak = $laptop->post('/me/password', ['current_password' => self::PASSWORD, 'new_password' => 'qwertyuiop']);
        self::assertSame(['new_password' => 'too_common'], $weak->payload()['error']['fields']);

        self::assertSame(204, $laptop->post('/me/password', [
            'current_password' => self::PASSWORD,
            'new_password' => 'Another-Pass-2026',
        ])->status());
        // This session survives, the other one dies, only this device is kept.
        self::assertSame(200, $laptop->get('/me/storage')->status());
        self::assertSame(401, $phone->get('/me/storage')->status());
        self::assertSame(1, $this->rows('remember_tokens'));
        $phone->dropSession();
        self::assertNull($phone->me()['user']);
        $laptop->dropSession();
        self::assertSame('Bob', $laptop->me()['user']['username'], 'current device remember cookie still valid');
    }

    public function testPrefsWhitelist(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD);
        self::assertSame(204, $client->put('/me/prefs/theme_scheme', ['value' => 'dark'])->status());
        self::assertSame(204, $client->put('/me/prefs/theme_style', ['value' => 'scifi'])->status());
        self::assertSame(204, $client->put('/me/prefs/editor', ['value' => ['grid' => true, 'snap' => 0.5]])->status());
        self::assertSame(422, $client->put('/me/prefs/theme_scheme', ['value' => 'pink'])->status());
        self::assertSame(['key' => 'invalid'], $client->put('/me/prefs/is_admin', ['value' => true])->payload()['error']['fields']);
        self::assertSame(['value' => 'required'], $client->put('/me/prefs/theme_style', [])->payload()['error']['fields']);
        self::assertSame(422, $client->put('/me/prefs/shortcuts', ['value' => ['x' => str_repeat('a', 20000)]])->status());
        self::assertSame(
            ['editor' => ['grid' => true, 'snap' => 0.5], 'theme_scheme' => 'dark', 'theme_style' => 'scifi'],
            $client->me()['prefs'],
        );
        self::assertSame(204, $client->put('/me/prefs/theme_style', ['value' => null])->status());
        self::assertArrayNotHasKey('theme_style', $client->me()['prefs']);
    }

    public function testDevices(): void
    {
        $this->createUser('Bob');
        $this->createUser('Carol');
        $laptop = $this->client('203.0.113.1');
        $laptop->login('Bob', self::PASSWORD, true);
        $phone = $this->client('203.0.113.2');
        $phone->userAgent = 'Phone UA';
        $phone->login('Bob', self::PASSWORD, true);
        $carol = $this->client('203.0.113.3');
        $carol->login('Carol', self::PASSWORD, true);

        $devices = $laptop->get('/me/devices')->payload()['data'];
        self::assertCount(2, $devices);
        $current = array_values(array_filter($devices, static fn (array $d): bool => $d['current']));
        self::assertCount(1, $current);
        self::assertSame(['id', 'user_agent', 'created_at', 'last_used_at', 'current'], array_keys($devices[0]));
        self::assertIsString($devices[0]['id']);
        $phoneDevice = array_values(array_filter($devices, static fn (array $d): bool => $d['user_agent'] === 'Phone UA'))[0];

        $carolDevice = $carol->get('/me/devices')->payload()['data'][0]['id'];
        self::assertSame(404, $laptop->delete('/me/devices/' . $carolDevice)->status());
        self::assertSame(204, $laptop->delete('/me/devices/' . $phoneDevice['id'])->status());
        self::assertCount(1, $laptop->get('/me/devices')->payload()['data']);
        $phone->dropSession();
        self::assertNull($phone->me()['user']);

        // Revoking the current device clears its cookie.
        self::assertSame(204, $laptop->delete('/me/devices/' . $current[0]['id'])->status());
        self::assertArrayNotHasKey(RememberMe::COOKIE, $laptop->cookies);
    }

    public function testStorageAndExport(): void
    {
        $id = $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD, true);
        self::assertSame(['used_bytes' => 0, 'quota_bytes' => 524288000], $client->get('/me/storage')->payload()['data']);
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_quota_bytes` = 1000, `storage_used_bytes` = 10 WHERE `id` = ?', [$id]);
        self::assertSame(['used_bytes' => 10, 'quota_bytes' => 1000], $client->get('/me/storage')->payload()['data']);

        $client->put('/me/prefs/theme_scheme', ['value' => 'light']);
        $export = $client->get('/me/export');
        self::assertSame(200, $export->status());
        self::assertStringStartsWith('attachment; filename="jdr-export-', (string) $export->header('Content-Disposition'));
        $doc = $export->payload();
        self::assertSame('jdr-personal-data', $doc['format']);
        self::assertSame((string) $id, $doc['user']['id']);
        self::assertSame('bob@example.org', $doc['user']['email']);
        self::assertSame(['theme_scheme' => 'light'], $doc['prefs']);
        self::assertCount(1, $doc['devices']);
        self::assertStringNotContainsString('password_hash', $export->body());
        self::assertStringNotContainsString('$argon2', $export->body());
    }

    public function testDeleteAccount(): void
    {
        $this->createUser('Admin', 'admin');
        $id = $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD, true);
        $client->put('/me/prefs/theme_scheme', ['value' => 'dark']);
        // An audit entry about Bob, written by the admin.
        $admin = $this->client('198.51.100.1');
        $admin->login('Admin', self::PASSWORD);
        $admin->patch('/admin/users/' . $id, ['storage_quota_bytes' => 5000]);
        self::assertSame(1, $this->rows('audit_log', "`entity` = 'user' AND `entity_id` = ? AND `data` IS NOT NULL", [$id]));

        self::assertSame(['password' => 'wrong_password'], $client->delete('/me', ['password' => 'nope-nope-nope'])->payload()['error']['fields']);
        self::assertSame(204, $client->delete('/me', ['password' => self::PASSWORD])->status());
        self::assertArrayNotHasKey('jdr_sid', $client->cookies);
        self::assertArrayNotHasKey(RememberMe::COOKIE, $client->cookies);

        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('users') . ' WHERE `id` = ?', [$id]);
        self::assertNotNull($row['deleted_at']);
        self::assertSame('deleted-' . $id . '@deleted.invalid', $row['email']);
        self::assertSame('deleted-' . $id, $row['username']);
        self::assertSame(0, $this->rows('remember_tokens'));
        self::assertSame(0, $this->rows('user_prefs'));
        self::assertSame(0, $this->rows('audit_log', "`entity` = 'user' AND `entity_id` = ? AND `data` IS NOT NULL", [$id]));
        self::assertSame(1, $this->rows('audit_log', "`action` = 'user.delete_self' AND `user_id` IS NULL"));
        // The e-mail and username are free again; the old account cannot log in.
        $again = $this->client('203.0.113.99');
        $again->me();
        self::assertSame(401, $again->post('/auth/login', ['identifier' => 'bob@example.org', 'password' => self::PASSWORD])->status());
        self::assertSame(201, $again->post('/auth/register', [
            'email' => 'bob@example.org', 'username' => 'Bob', 'password' => self::PASSWORD,
        ])->status());
    }

    public function testLastAdminCannotDeleteThemself(): void
    {
        $this->createUser('Admin', 'admin');
        $client = $this->client();
        $client->login('Admin', self::PASSWORD);
        $response = $client->delete('/me', ['password' => self::PASSWORD]);
        self::assertSame(409, $response->status());
        self::assertSame('last_admin', self::errorCode($response));
    }
}
