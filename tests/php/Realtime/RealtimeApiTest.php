<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Router;
use JDR\Realtime\Audience;

/**
 * GET /events and GET /stream through the HTTP kernel (envelope, errors, rights, session_close).
 */
final class RealtimeApiTest extends RealtimeTestCase
{
    public function testEventsEnvelopeAndIdsAsStrings(): void
    {
        ['gm' => $gm, 'channel' => $ch, 'mapChannel' => $mapCh] = $this->world();
        $a = $this->write([[$ch, 'session.state', Audience::ALL, ['state' => 'running', 'current_map_id' => 4]]]);
        $b = $this->write([[$mapCh, 'map.ops', Audience::GM, ['map_id' => 4, 'revision' => 3]]]);

        $response = $gm->get('/events?channels=' . $ch . ',' . $mapCh . '&since=0&wait=0');
        self::assertSame(200, $response->status(), $response->body());
        $payload = $response->payload();
        self::assertTrue($payload['ok']);
        self::assertSame((string) $b, $payload['data']['last_id']);
        self::assertSame([(string) $a, (string) $b], array_column($payload['data']['events'], 'id'));
        self::assertSame([
            'id' => (string) $a,
            'channel' => $ch,
            'type' => 'session.state',
            'payload' => ['state' => 'running', 'current_map_id' => '4'],
            'actor' => null,
            'client_op_id' => null,
            'at' => $payload['data']['events'][0]['at'],
        ], $payload['data']['events'][0]);
        self::assertSame('no-store', $response->header('Cache-Control'));

        $empty = $gm->get('/events?channels=' . $ch . '&since=' . $b)->payload()['data'];
        self::assertSame(['events' => [], 'last_id' => (string) $b], $empty);
    }

    public function testPlayerOnlyGetsHisAudience(): void
    {
        ['channel' => $ch] = $this->world();
        $bob = $this->client('198.51.100.200');
        $bob->login('Bob', self::PASSWORD);
        $this->write([
            [$ch, 'session.code', Audience::GM, ['code' => 'SECRET42']],
            [$ch, 'player.kicked', Audience::USER, ['reason' => null], $this->userId('Kim')],
            [$ch, 'player.ready', Audience::PLAYERS, ['user_id' => $this->userId('Bob'), 'ready' => true]],
        ]);
        $response = $bob->get('/events?channels=' . $ch);
        self::assertSame(200, $response->status(), $response->body());
        self::assertSame(['player.ready'], array_column($response->payload()['data']['events'], 'type'));
        self::assertStringNotContainsString('SECRET42', $response->body());
    }

    public function testErrors(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        self::assertSame(401, $this->client('198.51.100.201')->get('/events?channels=' . $ch)->status());
        self::assertSame(401, $this->client('198.51.100.202')->get('/stream?channels=' . $ch)->status());
        $this->assertFieldErrors($gm->get('/events'), ['channels' => 'required']);
        $this->assertFieldErrors($gm->get('/events?channels=lobby:1'), ['channels' => 'invalid']);
        $this->assertFieldErrors($gm->get('/events?channels=session:1,session:2,session:3,session:4,session:5'), ['channels' => 'too_many']);
        $this->assertFieldErrors($gm->get('/events?channels=' . $ch . '&since=-1'), ['since' => 'invalid']);
        $this->assertFieldErrors($gm->get('/events?channels=' . $ch . '&since=99999999999999999999'), ['since' => 'invalid']);
        $this->assertFieldErrors($gm->get('/events?channels=' . $ch . '&wait=21'), ['wait' => 'invalid']);
        $this->assertFieldErrors($gm->get('/events?channels=' . $ch . '&wait=abc'), ['wait' => 'invalid']);
        $this->assertFieldErrors($gm->get('/stream?channels=nope'), ['channels' => 'invalid']);

        $dan = $this->client('198.51.100.203');
        $dan->login('Dan', self::PASSWORD);
        self::assertSame(403, $dan->get('/events?channels=' . $ch)->status());
        self::assertSame(403, $dan->get('/stream?channels=' . $ch)->status());
        $eve = $this->client('198.51.100.204');
        $eve->login('Eve', self::PASSWORD);
        self::assertSame('not_found', self::errorCode($eve->get('/events?channels=' . $ch)));
        self::assertSame(404, $gm->get('/events?channels=session:987654')->status());
    }

    public function testEventsGone(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        $this->purgedUpto(20);
        $response = $gm->get('/events?channels=' . $ch . '&since=5');
        self::assertSame(410, $response->status());
        self::assertSame('events_gone', self::errorCode($response));
        self::assertSame(['channels' => $ch], $response->payload()['error']['fields']);
        self::assertSame(200, $gm->get('/events?channels=' . $ch . '&since=20')->status());
    }

    public function testLongPollingWaitsWithTheSimulatedClock(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        $start = $this->timer->now();
        $response = $gm->get('/events?channels=' . $ch . '&since=0&wait=20');
        self::assertSame(200, $response->status(), $response->body());
        self::assertSame([], $response->payload()['data']['events']);
        self::assertEqualsWithDelta(20.0, $this->timer->now() - $start, 0.001);
    }

    public function testStream(): void
    {
        ['gm' => $gm, 'channel' => $ch] = $this->world();
        $a = $this->write([[$ch, 'a.one', Audience::ALL, []]]);
        $b = $this->write([[$ch, 'a.two', Audience::ALL, []]]);

        $response = $gm->get('/stream?channels=' . $ch . '&since=0');
        self::assertSame(200, $response->status());
        self::assertSame('text/event-stream; charset=utf-8', $response->header('Content-Type'));
        self::assertSame('no', $response->header('X-Accel-Buffering'));
        self::assertNotNull($response->header('X-Request-Id'));
        self::assertStringContainsString("id: $a\nevent: a.one\n", $response->body());
        self::assertStringContainsString("id: $b\nevent: a.two\n", $response->body());

        // Last-Event-ID (EventSource reconnection) wins over ?since=.
        $again = $gm->request('GET', '/stream?channels=' . $ch . '&since=0', null, ['Last-Event-ID' => (string) $a]);
        self::assertStringNotContainsString('event: a.one', $again->body());
        self::assertStringContainsString("id: $b\nevent: a.two\n", $again->body());

        $this->purgedUpto($b);
        $gone = $gm->get('/stream?channels=' . $ch . '&since=' . $a);
        self::assertSame(200, $gone->status());
        self::assertStringEndsWith("event: events_gone\ndata: {\"channel\":\"$ch\"}\n\n", $gone->body());
    }

    public function testLongRoutesReleaseTheSession(): void
    {
        $router = new Router();
        (require self::projectRoot() . '/app/Http/routes.php')($router);
        foreach (['/events', '/stream'] as $path) {
            $match = $router->match('GET', $path);
            self::assertTrue($match->option('session_close'), $path);
            self::assertTrue($match->option('auth'), $path);
        }
    }
}
