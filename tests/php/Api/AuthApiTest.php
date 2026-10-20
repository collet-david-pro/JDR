<?php

declare(strict_types=1);

namespace JDR\Tests\Api;

use JDR\Core\App;
use JDR\Core\Clock;
use JDR\Core\Logger;
use JDR\Core\Request;
use JDR\Domain\Auth\RememberMe;

/**
 * /auth/*: registration (3 modes), login, logout, CSRF, rate limiting, suspension,
 * remember-me, password reset, invitations.
 */
final class AuthApiTest extends ApiTestCase
{
    public function testMeAnonymousCreatesSessionAndCsrf(): void
    {
        $client = $this->client();
        $response = $client->get('/auth/me');
        self::assertSame(200, $response->status());
        $data = $response->payload()['data'];
        self::assertNull($data['user']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $data['csrf']);
        self::assertSame([], $data['prefs']);
        self::assertSame('{', substr((string) json_encode($response->payload()['data']['prefs'] ?: new \stdClass()), 0, 1));
        self::assertSame('open', $data['registration_mode']);
        self::assertFalse($data['smtp_enabled']);
        self::assertArrayHasKey('jdr_sid', $client->cookies);
        // Same session => same token.
        self::assertSame($data['csrf'], $client->me()['csrf']);
    }

    public function testHealthDoesNotStartASession(): void
    {
        $client = $this->client();
        $client->get('/health');
        self::assertSame([], $client->cookies);
        self::assertSame(0, $this->sessions->count());
    }

    public function testHealthIgnoresSessionCookies(): void
    {
        $client = $this->client();
        $client->me();
        $before = $this->sessions->count();
        $client->cookies[RememberMe::COOKIE] = str_repeat('a', 24) . ':' . str_repeat('b', 64);
        self::assertSame(200, $client->get('/health')->status());
        self::assertSame($before, $this->sessions->count());
        self::assertArrayHasKey(RememberMe::COOKIE, $client->cookies, 'cookie untouched');

        // Not installed (no config.php): stale cookies must not break /health.
        $bare = App::create(self::$root, null, Logger::discard());
        $response = $bare->handle(Request::create('GET', '/api/v1/health', [], '', '', [], [
            'jdr_sid' => 'abcdefabcdefabcdefabcdef', RememberMe::COOKIE => $client->cookies[RememberMe::COOKIE],
        ]));
        self::assertSame(200, $response->status());
    }

    public function testRegisterOpenLogsInDirectly(): void
    {
        $client = $this->client();
        $client->me();
        $response = $client->post('/auth/register', [
            'email' => '  Alice@Example.ORG ',
            'username' => 'Alice',
            'password' => self::PASSWORD,
        ]);
        self::assertSame(201, $response->status(), $response->body());
        $data = $response->payload()['data'];
        $user = $data['user'];
        self::assertSame(
            ['id', 'email', 'username', 'role', 'status', 'locale', 'storage_quota_bytes', 'storage_used_bytes',
                'email_verified_at', 'last_login_at', 'created_at'],
            array_keys($user),
        );
        self::assertIsString($user['id']);
        self::assertSame('alice@example.org', $user['email']);
        self::assertSame('user', $user['role']);
        self::assertSame('active', $user['status']);
        self::assertNull($user['storage_quota_bytes']);
        self::assertSame(0, $user['storage_used_bytes']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $user['created_at']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $data['csrf']);
        self::assertSame('Alice', $client->me()['user']['username']);

        $again = $this->client('203.0.113.11');
        $again->me();
        $dup = $again->post('/auth/register', ['email' => 'alice@example.org', 'username' => 'alice', 'password' => self::PASSWORD]);
        self::assertSame(422, $dup->status());
        self::assertSame(['email' => 'taken', 'username' => 'taken'], $dup->payload()['error']['fields']);
    }

    public function testRegisterValidation(): void
    {
        $client = $this->client();
        $client->me();
        $response = $client->post('/auth/register', ['email' => 'nope', 'username' => 'a', 'password' => 'qwertyuiop']);
        self::assertSame(422, $response->status());
        self::assertSame('validation_failed', self::errorCode($response));
        self::assertSame(
            ['email' => 'invalid', 'username' => 'too_short', 'password' => 'too_common'],
            $response->payload()['error']['fields'],
        );
        $short = $client->post('/auth/register', ['email' => 'b@example.org', 'username' => 'bob', 'password' => 'short']);
        self::assertSame('too_short', $short->payload()['error']['fields']['password']);
        $empty = $client->post('/auth/register', []);
        self::assertSame(['email' => 'required', 'username' => 'required', 'password' => 'required'], $empty->payload()['error']['fields']);
    }

    public function testRegisterClosed(): void
    {
        $this->setSetting('registration_mode', 'closed');
        $client = $this->client();
        self::assertSame('closed', $client->me()['registration_mode']);
        $response = $client->post('/auth/register', ['email' => 'c@example.org', 'username' => 'carol', 'password' => self::PASSWORD]);
        self::assertSame(403, $response->status());
        self::assertSame('registration_closed', self::errorCode($response));
        self::assertSame(0, $this->rows('users'));
    }

    public function testRegisterInviteMode(): void
    {
        $this->setSetting('registration_mode', 'invite');
        $adminId = $this->createUser('Admin', 'admin');
        $admin = $this->client('198.51.100.1');
        $admin->login('Admin', self::PASSWORD);
        $created = $admin->post('/admin/invitations', ['max_uses' => 1, 'expires_in_days' => 7]);
        self::assertSame(201, $created->status(), $created->body());
        $code = $created->payload()['data']['code'];
        self::assertSame('http://jdr.test/invite/' . $code, $created->payload()['data']['url']);
        self::assertSame((string) $adminId, $created->payload()['data']['invitation']['created_by']);
        $nominative = $admin->post('/admin/invitations', ['email' => 'Dave@Example.org', 'max_uses' => 1]);
        $nominativeCode = $nominative->payload()['data']['code'];

        $guest = $this->client();
        $guest->me();
        self::assertSame(['valid' => true, 'email' => null], $guest->get('/invitations/' . $code)->payload()['data']);
        self::assertSame(['valid' => false, 'email' => null], $guest->get('/invitations/WRONGCODE')->payload()['data']);
        self::assertSame(
            ['valid' => true, 'email' => 'dave@example.org'],
            $guest->get('/invitations/' . $nominativeCode)->payload()['data'],
        );

        $missing = $guest->post('/auth/register', ['email' => 'e@example.org', 'username' => 'erin', 'password' => self::PASSWORD]);
        self::assertSame(['invitation_code' => 'required'], $missing->payload()['error']['fields']);
        $bad = $guest->post('/auth/register', [
            'email' => 'e@example.org', 'username' => 'erin', 'password' => self::PASSWORD, 'invitation_code' => 'XXXX',
        ]);
        self::assertSame(['invitation_code' => 'invalid'], $bad->payload()['error']['fields']);
        $mismatch = $guest->post('/auth/register', [
            'email' => 'e@example.org', 'username' => 'erin', 'password' => self::PASSWORD, 'invitation_code' => $nominativeCode,
        ]);
        self::assertSame(['email' => 'mismatch'], $mismatch->payload()['error']['fields']);

        $ok = $guest->post('/auth/register', [
            'email' => 'e@example.org', 'username' => 'erin', 'password' => self::PASSWORD,
            'invitation_code' => strtolower($code),
        ]);
        self::assertSame(201, $ok->status(), $ok->body());

        // Single use.
        $other = $this->client('203.0.113.12');
        $other->me();
        $reuse = $other->post('/auth/register', [
            'email' => 'f@example.org', 'username' => 'frank', 'password' => self::PASSWORD, 'invitation_code' => $code,
        ]);
        self::assertSame(['invitation_code' => 'invalid'], $reuse->payload()['error']['fields']);
        self::assertFalse($other->get('/invitations/' . $code)->payload()['data']['valid']);
        // Only the hash is stored.
        self::assertSame(0, $this->rows('invitations', '`code_hash` = ?', [$code]));
        self::assertSame(1, $this->rows('invitations', '`code_hash` = ?', [hash('sha256', $code)]));
    }

    public function testLoginLogoutAndIdenticalFailures(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->me();
        $sidBefore = $client->cookies['jdr_sid'];

        $unknown = $client->post('/auth/login', ['identifier' => 'nobody', 'password' => self::PASSWORD, 'remember' => false]);
        $wrong = $client->post('/auth/login', ['identifier' => 'bob', 'password' => 'Wrong-password-123', 'remember' => false]);
        self::assertSame(401, $unknown->status());
        self::assertSame(401, $wrong->status());
        self::assertSame('invalid_credentials', self::errorCode($unknown));
        self::assertSame($unknown->payload()['error'], $wrong->payload()['error']);

        $data = $client->login('BOB@example.org', self::PASSWORD);
        self::assertSame('Bob', $data['user']['username']);
        self::assertNotNull($data['user']['last_login_at']);
        self::assertNotSame($sidBefore, $client->cookies['jdr_sid'], 'session id regenerated at login');
        self::assertSame('Bob', $client->me()['user']['username']);
        self::assertSame(1, $this->rows('login_attempts', '`success` = 1'));
        self::assertSame(2, $this->rows('login_attempts', '`success` = 0'));

        self::assertSame(204, $client->post('/auth/logout')->status());
        self::assertArrayNotHasKey('jdr_sid', $client->cookies);
        self::assertNull($client->me()['user']);
        self::assertSame(401, $client->get('/me/storage')->status());
    }

    public function testCsrfIsRequired(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->me();
        $noToken = $client->request('POST', '/auth/login', ['identifier' => 'Bob', 'password' => self::PASSWORD], [], false);
        self::assertSame(403, $noToken->status());
        self::assertSame('csrf_invalid', self::errorCode($noToken));
        $badToken = $client->request('POST', '/auth/login', ['identifier' => 'Bob', 'password' => self::PASSWORD], [
            'X-CSRF-Token' => str_repeat('a', 64),
        ], false);
        self::assertSame(403, $badToken->status());
        // Without any session at all.
        $fresh = $this->client();
        self::assertSame(403, $fresh->request('POST', '/auth/logout', [], [], false)->status());
        // Token of another session.
        $other = $this->client();
        $other->me();
        $stolen = $other->request('POST', '/auth/login', ['identifier' => 'Bob', 'password' => self::PASSWORD], [
            'X-CSRF-Token' => (string) $client->csrf,
        ], false);
        self::assertSame(403, $stolen->status());
        // Logged in: token rotated by the login, the old one is refused.
        $old = $client->csrf;
        $client->login('Bob', self::PASSWORD);
        self::assertNotSame($old, $client->csrf);
        $refused = $client->request('PUT', '/me/prefs/theme_scheme', ['value' => 'dark'], ['X-CSRF-Token' => (string) $old], false);
        self::assertSame(403, $refused->status());
        self::assertSame(204, $client->put('/me/prefs/theme_scheme', ['value' => 'dark'])->status());
    }

    public function testSixFailedLoginsBlockTemporarily(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->me();
        for ($i = 1; $i <= 5; $i++) {
            $r = $client->post('/auth/login', ['identifier' => 'bob', 'password' => 'Wrong-password-' . $i, 'remember' => false]);
            self::assertSame(401, $r->status(), 'attempt ' . $i);
        }
        $sixth = $client->post('/auth/login', ['identifier' => 'bob', 'password' => 'Wrong-password-6', 'remember' => false]);
        self::assertSame(429, $sixth->status());
        self::assertSame('rate_limited', self::errorCode($sixth));
        self::assertGreaterThanOrEqual(1, (int) $sixth->header('Retry-After'));
        // Even the right password is refused while blocked.
        $right = $client->post('/auth/login', ['identifier' => 'bob', 'password' => self::PASSWORD, 'remember' => false]);
        self::assertSame(429, $right->status());
        // Another IP is not blocked (key = identifier + IP).
        $elsewhere = $this->client('198.51.100.77');
        self::assertSame('Bob', $elsewhere->login('bob', self::PASSWORD)['user']['username']);

        // The block expires: 2 minutes later, login works and clears the bucket.
        $later = $this->makeApp(Clock::at('+2 minutes'));
        $client->withApp($later);
        self::assertSame('Bob', $client->login('bob', self::PASSWORD)['user']['username']);
        self::assertSame(0, $this->rows('rate_limits', '`bucket` LIKE ?', ['login:bob:%']));
    }

    public function testRegisterIsRateLimitedPerIp(): void
    {
        $client = $this->client();
        $client->me();
        for ($i = 1; $i <= 5; $i++) {
            $r = $client->post('/auth/register', ['email' => 'x', 'username' => 'u' . $i, 'password' => self::PASSWORD]);
            self::assertSame(422, $r->status());
        }
        $r = $client->post('/auth/register', ['email' => 'x', 'username' => 'u6', 'password' => self::PASSWORD]);
        self::assertSame(429, $r->status());
        self::assertNotNull($r->header('Retry-After'));
    }

    public function testSuspensionLogsOutImmediately(): void
    {
        $this->createUser('Admin', 'admin');
        $bobId = $this->createUser('Bob');
        $bob = $this->client();
        $bob->login('Bob', self::PASSWORD, true);
        self::assertSame(200, $bob->get('/me/storage')->status());
        self::assertSame(1, $this->rows('remember_tokens'));

        $admin = $this->client('198.51.100.1');
        $admin->login('Admin', self::PASSWORD);
        $suspend = $admin->post('/admin/users/' . $bobId . '/suspend');
        self::assertSame(200, $suspend->status(), $suspend->body());
        self::assertSame('suspended', $suspend->payload()['data']['user']['status']);
        self::assertSame(0, $this->rows('remember_tokens'));

        // Very next request: 401, session destroyed, remember cookie useless.
        $next = $bob->get('/me/storage');
        self::assertSame(401, $next->status());
        self::assertSame('unauthenticated', self::errorCode($next));
        self::assertArrayNotHasKey('jdr_sid', $bob->cookies);
        self::assertNull($bob->me()['user']);
        // Right password, suspended account.
        $login = $bob->post('/auth/login', ['identifier' => 'Bob', 'password' => self::PASSWORD, 'remember' => false]);
        self::assertSame(403, $login->status());
        self::assertSame('account_suspended', self::errorCode($login));

        self::assertSame('active', $admin->post('/admin/users/' . $bobId . '/unsuspend')->payload()['data']['user']['status']);
        self::assertSame('Bob', $bob->login('Bob', self::PASSWORD)['user']['username']);
    }

    public function testRememberMeRotationAndTheftDetection(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD, true);
        $first = $client->cookies[RememberMe::COOKIE];
        self::assertMatchesRegularExpression('/^[0-9a-f]{24}:[0-9a-f]{64}$/', $first);
        [$selector, $validator] = explode(':', $first);
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('remember_tokens'));
        self::assertSame($selector, $row['selector']);
        self::assertSame(hash('sha256', $validator), $row['validator_hash']);
        self::assertSame('PHPUnit browser', $row['user_agent']);

        // Browser restart: the session is gone, the remember cookie logs back in and rotates.
        $stolenCopy = $first;
        $client->dropSession();
        $me = $client->me();
        self::assertSame('Bob', $me['user']['username']);
        $second = $client->cookies[RememberMe::COOKIE];
        self::assertNotSame($first, $second);
        self::assertSame($selector, explode(':', $second)[0]);
        self::assertSame(1, $this->rows('remember_tokens'));

        // Replay of the old cookie within the race window: refused but nothing revoked.
        $thief = $this->client('192.0.2.66');
        $thief->cookies[RememberMe::COOKIE] = $stolenCopy;
        self::assertNull($thief->me()['user']);
        self::assertSame(1, $this->rows('remember_tokens'));

        // Replay later: theft detected, every token of the account revoked.
        $this->db->execute('UPDATE ' . $this->db->t('remember_tokens') . ' SET `last_used_at` = UTC_TIMESTAMP() - INTERVAL 10 MINUTE');
        $thief2 = $this->client('192.0.2.67');
        $thief2->cookies[RememberMe::COOKIE] = $stolenCopy;
        self::assertNull($thief2->me()['user']);
        self::assertSame(0, $this->rows('remember_tokens'));
        self::assertArrayNotHasKey(RememberMe::COOKIE, $thief2->cookies);
        // The legitimate cookie is revoked too.
        $client->dropSession();
        self::assertNull($client->me()['user']);
    }

    public function testExpiredRememberTokenIsRefused(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD, true);
        $this->db->execute('UPDATE ' . $this->db->t('remember_tokens') . ' SET `expires_at` = UTC_TIMESTAMP() - INTERVAL 1 SECOND');
        $client->dropSession();
        self::assertNull($client->me()['user']);
        self::assertSame(0, $this->rows('remember_tokens'));
    }

    public function testSessionIdleTimeout(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD);
        $client->withApp($this->makeApp(Clock::at('+11 hours')));
        self::assertSame('Bob', $client->me()['user']['username']);
        $client->withApp($this->makeApp(Clock::at('+24 hours')));
        self::assertNull($client->me()['user'], 'idle more than 12 h');
    }

    public function testLogoutRevokesRememberToken(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->login('Bob', self::PASSWORD, true);
        self::assertSame(1, $this->rows('remember_tokens'));
        self::assertSame(204, $client->post('/auth/logout')->status());
        self::assertSame(0, $this->rows('remember_tokens'));
        self::assertArrayNotHasKey(RememberMe::COOKIE, $client->cookies);
    }

    public function testForgotWithoutSmtpSaysContactAdmin(): void
    {
        $this->createUser('Bob');
        $client = $this->client();
        $client->me();
        foreach (['bob@example.org', 'nobody@example.org'] as $email) {
            $r = $client->post('/auth/password/forgot', ['email' => $email]);
            self::assertSame(200, $r->status());
            self::assertSame(['mode' => 'contact_admin'], $r->payload()['data']);
        }
        self::assertSame(0, $this->rows('password_resets'));
        $client->post('/auth/password/forgot', ['email' => 'bob@example.org']);
        $client->post('/auth/password/forgot', ['email' => 'bob@example.org']);
        self::assertSame(429, $client->post('/auth/password/forgot', ['email' => 'bob@example.org'])->status());
    }

    public function testResetLinkFromAdminIsSingleUse(): void
    {
        $this->createUser('Admin', 'admin');
        $bobId = $this->createUser('Bob');
        $bob = $this->client('203.0.113.50');
        $bob->login('Bob', self::PASSWORD, true);

        $admin = $this->client('198.51.100.1');
        $admin->login('Admin', self::PASSWORD);
        $link = $admin->post('/admin/users/' . $bobId . '/reset-link')->payload()['data'];
        self::assertStringStartsWith('http://jdr.test/reset-password/', $link['url']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $link['expires_at']);
        $token = rawurldecode(substr($link['url'], strlen('http://jdr.test/reset-password/')));

        $guest = $this->client('203.0.113.60');
        $guest->me();
        $weak = $guest->post('/auth/password/reset', ['token' => $token, 'password' => 'short']);
        self::assertSame(422, $weak->status());
        $tampered = $guest->post('/auth/password/reset', ['token' => $token . 'x', 'password' => 'New-Password-2026!']);
        self::assertSame(410, $tampered->status());
        self::assertSame('reset_link_invalid', self::errorCode($tampered));

        $ok = $guest->post('/auth/password/reset', ['token' => $token, 'password' => 'New-Password-2026!']);
        self::assertSame(200, $ok->status(), $ok->body());
        self::assertSame([], $ok->payload()['data']);
        self::assertSame('{"ok":true,"data":{},"meta":{}}', $ok->body());
        self::assertSame(410, $guest->post('/auth/password/reset', ['token' => $token, 'password' => 'Other-Password-2026!'])->status());

        // Old sessions and devices revoked; new password works.
        self::assertSame(401, $bob->get('/me/storage')->status());
        self::assertSame(0, $this->rows('remember_tokens'));
        self::assertSame('Bob', $guest->login('Bob', 'New-Password-2026!')['user']['username']);
        // Token stored hashed only.
        self::assertSame(0, $this->rows('password_resets', '`token_hash` = ?', [$token]));
    }

    public function testExpiredResetLink(): void
    {
        $bobId = $this->createUser('Bob');
        $adminId = $this->createUser('Admin', 'admin');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        $link = $admin->post('/admin/users/' . $bobId . '/reset-link')->payload()['data'];
        $token = rawurldecode(substr($link['url'], strlen('http://jdr.test/reset-password/')));
        $guest = $this->client()->withApp($this->makeApp(Clock::at('+61 minutes')));
        $guest->me();
        self::assertSame(410, $guest->post('/auth/password/reset', ['token' => $token, 'password' => 'New-Password-2026!'])->status());
        self::assertGreaterThan(0, $adminId);
    }
}
