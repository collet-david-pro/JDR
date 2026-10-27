<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

use JDR\Core\Clock;

/**
 * Device side: pairing, GET /display/me, identity next to a logged-in user, unpair.
 */
final class DisplayPairingTest extends DisplaysTestCase
{
    public function testPairingSetsTheCookieAndActivates(): void
    {
        $w = $this->arena();
        $d = $this->makeDisplay($w['gm'], $w['session']);
        $code = $d['pairing']['code'];
        $screen = $this->screen();
        $head = $this->head();

        $r = $screen->post('/display/pair', ['code' => substr($code, 0, 3) . ' - ' . substr($code, 3)]);
        $data = self::data($this->ok($r));
        self::assertSame($d['id'], $data['display']['id']);
        self::assertSame(['display.paired/gm'], $this->kinds($head));

        $token = $screen->cookies['jdr_display'] ?? '';
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/D', $token);
        $cookie = $this->jar->last('jdr_display');
        self::assertNotNull($cookie);
        self::assertSame('Strict', $cookie['samesite']);
        self::assertEqualsWithDelta(time() + 30 * 86400, $cookie['expires'], 10);
        self::assertSame('/', $cookie['path']);

        $row = $this->displayRow($d['id']);
        self::assertSame('active', $row['state']);
        self::assertNull($row['pairing_code_hash']);
        self::assertNull($row['pairing_expires_at']);
        self::assertSame(hash('sha256', $token), $row['device_token_hash']);
        self::assertNotNull($row['paired_at']);
        self::assertSame('PHPUnit browser', $row['user_agent']);

        $event = $this->events($head)[0];
        self::assertSame('active', $event['payload']['display']['state']);
        self::assertArrayNotHasKey('pairing', $event['payload']['display']);

        // The code is single use.
        $other = $this->screen();
        $r = $other->post('/display/pair', ['code' => $code]);
        self::assertSame(422, $r->status());
        self::assertSame('display_code_invalid', $this->errorCode($r));
        self::assertArrayNotHasKey('jdr_display', $other->cookies);
    }

    public function testInvalidExpiredAndEndedCodes(): void
    {
        $w = $this->arena();
        $d = $this->makeDisplay($w['gm'], $w['session']);
        $code = $d['pairing']['code'];
        $screen = $this->screen();
        $unknown = $code === '000000' ? '111111' : '000000';
        foreach ([$unknown, '12345', '1234567', 'abcdef', '12 34 5x', ''] as $bad) {
            $r = $screen->post('/display/pair', ['code' => $bad]);
            self::assertSame(422, $r->status(), $bad);
            self::assertSame('display_code_invalid', $this->errorCode($r));
        }
        self::assertSame(422, $screen->post('/display/pair', [])->status());
        self::assertSame(422, $screen->post('/display/pair', ['code' => [1]])->status());

        $screen = $this->screen(); // 10 attempts per minute and per IP
        $this->setDisplay($d['id'], 'pairing_expires_at', gmdate('Y-m-d H:i:s', time() - 5));
        self::assertSame(422, $screen->post('/display/pair', ['code' => $code])->status(), 'expired');
        $this->setDisplay($d['id'], 'pairing_expires_at', gmdate('Y-m-d H:i:s', time() + 300));
        $this->setState($w['session'], 'ended');
        self::assertSame(422, $screen->post('/display/pair', ['code' => $code])->status(), 'ended session');
        $this->setState($w['session'], 'lobby');
        $this->ok($screen->post('/display/pair', ['code' => $code]));
    }

    public function testRateLimitAndCsrf(): void
    {
        $this->arena();
        $screen = $this->screen();
        for ($i = 0; $i < 10; $i++) {
            self::assertSame(422, $screen->post('/display/pair', ['code' => '000000'])->status());
        }
        self::assertSame(429, $screen->post('/display/pair', ['code' => '000000'])->status());

        $noCsrf = $this->screen();
        $r = $noCsrf->request('POST', '/display/pair', ['code' => '000000'], [], false);
        self::assertSame(403, $r->status());
        self::assertSame('csrf_invalid', $this->errorCode($r));
    }

    public function testDisplayMeShapeAndNoLeak(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $head = $this->head();
        $me = self::data($this->ok($screen->get('/display/me?as=display')));
        self::assertSame(['id', 'name', 'settings', 'session', 'status', 'last_event_id'], array_keys($me));
        self::assertSame($d['id'], $me['id']);
        self::assertSame('Table', $me['name']);
        self::assertSame(['id', 'game_id', 'name', 'state', 'current_map_id', 'current_floor_id', 'camera', 'pause_screen'], array_keys($me['session']));
        self::assertSame($w['session'], $me['session']['id']);
        self::assertSame($w['game'], $me['session']['game_id']);
        self::assertSame($w['map'], $me['session']['current_map_id']);
        self::assertSame('lobby', $me['status']);
        self::assertSame((string) $head, $me['last_event_id']);

        $json = (string) json_encode($me);
        self::assertStringNotContainsString($w['code'], $json, 'session code');
        foreach (['players', 'assignments', 'code', 'user_id', 'Bob', 'username'] as $needle) {
            self::assertStringNotContainsString('"' . $needle . '"', $json);
        }
        self::assertSame(1, preg_match('/"last_event_id"/', $json));

        // The route is "only": the screen is identified with or without as=display.
        self::assertSame($d['id'], self::data($this->ok($screen->get('/display/me')))['id']);

        // Ending through the API revokes the screen (P7g): the defensive 'waiting' status is forced in the DB.
        $this->setState($w['session'], 'ended');
        $ended = self::data($this->ok($screen->get('/display/me?as=display')));
        self::assertSame('ended', $ended['session']['state']);
        self::assertSame('waiting', $ended['status']);
        $this->setState($w['session'], 'paused');
        self::assertSame('paused', self::data($this->ok($screen->get('/display/me?as=display')))['status']);
    }

    public function testUnknownAndMalformedTokens(): void
    {
        $w = $this->arena();
        $this->pairedScreen($w['gm'], $w['session']);
        $fake = $this->screen();
        foreach (['', 'short', str_repeat('A', 43), str_repeat('!', 43), str_repeat('A', 44)] as $token) {
            $fake->cookies['jdr_display'] = $token;
            $r = $fake->get('/display/me?as=display');
            self::assertSame(401, $r->status(), $token);
            self::assertSame('display_unpaired', $this->errorCode($r));
        }
        unset($fake->cookies['jdr_display']);
        self::assertSame(401, $fake->get('/display/me?as=display')->status());
    }

    public function testOnlineAndLastSeenThrottle(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $list = static fn (): array => self::data($w['gm']->get('/sessions/' . $w['session'] . '/displays'))['displays'][0];
        self::assertTrue($list()['online']);
        $this->setDisplay($d['id'], 'last_seen_at', gmdate('Y-m-d H:i:s', time() - 10));
        $screen->get('/display/me?as=display');
        self::assertEqualsWithDelta(time() - 10, strtotime((string) $this->displayRow($d['id'])['last_seen_at'] . ' UTC'), 3, 'not touched within 20 s');
        $this->setDisplay($d['id'], 'last_seen_at', gmdate('Y-m-d H:i:s', time() - 30));
        self::assertTrue($list()['online'], 'still online (< 60 s)');
        $screen->get('/display/me?as=display');
        self::assertEqualsWithDelta(time(), strtotime((string) $this->displayRow($d['id'])['last_seen_at'] . ' UTC'), 3, 'touched after 20 s');
        $this->setDisplay($d['id'], 'last_seen_at', gmdate('Y-m-d H:i:s', time() - 61));
        self::assertFalse($list()['online']);
    }

    public function testCookieIsRenewedAfterADay(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $token = $screen->cookies['jdr_display'];
        $this->jar->drain();
        $screen->get('/display/me?as=display');
        self::assertArrayNotHasKey('jdr_display', $this->jar->drain(), 'fresh cookie: not renewed');

        $this->setDisplay($d['id'], 'paired_at', gmdate('Y-m-d H:i:s', time() - 2 * 86400));
        $before = $this->jar->last('jdr_display');
        $screen->get('/display/me?as=display');
        $after = $this->jar->last('jdr_display');
        self::assertNotNull($after);
        self::assertSame($token, $after['value'], 'same value');
        self::assertSame($token, $screen->cookies['jdr_display']);
        self::assertSame('Strict', $after['samesite']);
        self::assertGreaterThan($before['expires'], $after['expires'] + 1);
        self::assertEqualsWithDelta(time() + 30 * 86400, $after['expires'], 10);
    }

    public function testLoggedInUserAndScreenInTheSameBrowser(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        // Alice's browser also holds the screen cookie.
        $w['gm']->cookies['jdr_display'] = $screen->cookies['jdr_display'];
        $me = self::data($this->ok($w['gm']->get('/display/me?as=display')));
        self::assertSame($d['id'], $me['id'], 'the screen');
        self::assertSame($w['session'], self::data($this->ok($w['gm']->get('/sessions/' . $w['session'])))['id'], 'the GM without as=display');
        self::assertSame('gm', self::data($this->ok($w['gm']->get('/sessions/' . $w['session'])))['role']);
        // Alice without the cookie is not a screen.
        $alice = $this->loginAs('Alice');
        $r = $alice->get('/display/me?as=display');
        self::assertSame(401, $r->status());
        self::assertSame('display_unpaired', $this->errorCode($r));
    }

    public function testUnpair(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $head = $this->head();
        $this->ok($screen->post('/display/unpair?as=display'), 204);
        self::assertSame(['display.revoked/gm', 'display.revoked/displays'], $this->kinds($head));
        self::assertNull($this->displayRow($d['id']));
        self::assertArrayNotHasKey('jdr_display', $screen->cookies, 'cookie cleared');
        $cleared = $this->jar->last('jdr_display');
        self::assertSame('', $cleared['value']);
        self::assertSame('Strict', $cleared['samesite']);
        self::assertSame(401, $screen->get('/display/me?as=display')->status());
        self::assertSame(401, $screen->post('/display/unpair')->status());
    }

    public function testAsDisplayOptionOfTheMiddleware(): void
    {
        // display => true: the screen only with as=display (tested through the middleware itself).
        $w = $this->arena();
        [$screen] = $this->pairedScreen($w['gm'], $w['session']);
        $auth = new \JDR\Middleware\Auth(
            static fn () => null,
            new \JDR\Core\Logger(self::$logDir, new Clock(), 'debug'),
            fn () => $this->app->container()->get(\JDR\Domain\Displays\DisplayAuth::class),
        );
        $route = static fn (string $q): \JDR\Core\Request => (static function () use ($q, $screen): \JDR\Core\Request {
            $r = \JDR\Core\Request::create('GET', '/api/v1/x' . $q, [], '', '', ['REMOTE_ADDR' => '203.0.113.9'], $screen->cookies);
            $r->setAttribute('route', new \JDR\Core\RouteMatch('/x', static fn () => null, [], ['display' => true]));

            return $r;
        })();
        $seen = null;
        $auth->process($route('?as=display'), function (\JDR\Core\Request $r) use (&$seen): \JDR\Core\Response {
            $seen = $r->attribute('display');

            return \JDR\Core\Response::noContent();
        });
        self::assertInstanceOf(\JDR\Domain\Displays\Display::class, $seen);

        $seen = 'untouched';
        $auth->process($route(''), function (\JDR\Core\Request $r) use (&$seen): \JDR\Core\Response {
            $seen = $r->attribute('display');

            return \JDR\Core\Response::noContent();
        });
        self::assertNull($seen, 'no as=display: not a screen');

        try {
            $bad = $route('?as=display');
            $bad2 = \JDR\Core\Request::create('GET', '/api/v1/x?as=display', [], '', '', [], ['jdr_display' => str_repeat('A', 43)]);
            $bad2->setAttribute('route', $bad->attribute('route'));
            $auth->process($bad2, static fn () => \JDR\Core\Response::noContent());
            self::fail('401 expected');
        } catch (\JDR\Core\Errors\UnauthenticatedException $e) {
            self::assertSame('display_unpaired', $e->errorCode());
        }
    }
}
