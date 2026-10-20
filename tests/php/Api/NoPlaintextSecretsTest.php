<?php

declare(strict_types=1);

namespace JDR\Tests\Api;

/**
 * Acceptance P1: no password in clear, neither in the database nor in storage/logs.
 */
final class NoPlaintextSecretsTest extends ApiTestCase
{
    public function testPasswordsNeverStoredOrLoggedInClear(): void
    {
        $secrets = [
            'register' => 'Register-Secret-111',
            'wrong' => 'Wrong-Secret-222',
            'changed' => 'Changed-Secret-333',
            'reset' => 'Reset-Secret-444',
            'smtp' => 'Smtp-Secret-555',
            'admin_created' => 'Created-Secret-666',
        ];
        $this->createUser('Admin', 'admin');
        $admin = $this->client('198.51.100.1');
        $admin->login('Admin', self::PASSWORD, true);

        $user = $this->client();
        $user->me();
        self::assertSame(201, $user->post('/auth/register', [
            'email' => 'zoe@example.org', 'username' => 'Zoe', 'password' => $secrets['register'],
        ])->status());
        $user->post('/auth/logout');
        $user->me();
        self::assertSame(401, $user->post('/auth/login', ['identifier' => 'zoe', 'password' => $secrets['wrong']])->status());
        $user->login('zoe@example.org', $secrets['register'], true);
        self::assertSame(204, $user->post('/me/password', [
            'current_password' => $secrets['register'], 'new_password' => $secrets['changed'],
        ])->status());
        self::assertSame(422, $user->patch('/me', ['email' => 'z2@example.org', 'current_password' => $secrets['wrong']])->status());

        $zoeId = (int) $user->me()['user']['id'];
        $link = $admin->post('/admin/users/' . $zoeId . '/reset-link')->payload()['data'];
        $token = rawurldecode(substr($link['url'], strlen('http://jdr.test/reset-password/')));
        self::assertSame(200, $user->post('/auth/password/reset', ['token' => $token, 'password' => $secrets['reset']])->status());
        self::assertSame(200, $admin->patch('/admin/settings', ['smtp' => [
            'host' => 'smtp.example.org', 'from_email' => 'jdr@example.org', 'password' => $secrets['smtp'],
        ]])->status());
        self::assertSame(201, $admin->post('/admin/users', [
            'email' => 'yan@example.org', 'username' => 'Yan', 'password' => $secrets['admin_created'],
        ])->status());
        // Another failed login (journal + rate limit rows).
        $user->post('/auth/login', ['identifier' => 'zoe', 'password' => $secrets['wrong']]);

        // Something gets logged: a replayed remember-me cookie (warning).
        $old = $admin->cookies['jdr_remember'];
        $admin->dropSession();
        $admin->me();
        $this->db->execute('UPDATE ' . $this->db->t('remember_tokens') . ' SET `last_used_at` = UTC_TIMESTAMP() - INTERVAL 1 HOUR');
        $thief = $this->client('192.0.2.1');
        $thief->cookies['jdr_remember'] = $old;
        self::assertNull($thief->me()['user']);

        $haystacks = ['database' => $this->dumpDatabase(), 'logs' => $this->readLogs()];
        self::assertNotSame('', $haystacks['logs'], 'the logger did write something');
        foreach ($haystacks as $where => $haystack) {
            foreach ($secrets as $name => $secret) {
                self::assertStringNotContainsString($secret, $haystack, $name . ' found in ' . $where);
                self::assertStringNotContainsString(base64_encode($secret), $haystack, $name . ' (base64) found in ' . $where);
            }
            self::assertStringNotContainsString(self::PASSWORD, $haystack, 'fixture password found in ' . $where);
            self::assertStringNotContainsString($token, $haystack, 'reset token found in ' . $where);
        }
    }

    private function dumpDatabase(): string
    {
        $out = '';
        foreach (self::testTables($this->db) as $table) {
            foreach ($this->db->fetchAll('SELECT * FROM `' . $table . '`') as $row) {
                $out .= $table . ' ' . json_encode($row, JSON_INVALID_UTF8_SUBSTITUTE) . "\n";
                foreach ($row as $value) {
                    if (is_string($value)) {
                        $out .= $value . "\n";
                    }
                }
            }
        }

        return $out;
    }

    private function readLogs(): string
    {
        $out = '';
        foreach (glob(self::$logDir . '/*.log') ?: [] as $file) {
            $out .= (string) file_get_contents($file);
        }

        return $out;
    }
}
