<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Realtime\Audience;
use JDR\Realtime\BufferSseOutput;
use JDR\Realtime\SseStream;

/**
 * SSE stream (projet.md 10.3, contract P6a) captured in a buffer, with a simulated clock.
 */
final class SseStreamTest extends RealtimeTestCase
{
    private function stream(): SseStream
    {
        return $this->app->container()->get(SseStream::class);
    }

    /**
     * Blocks of the stream after the padding comment (split on blank lines).
     *
     * @return list<string>
     */
    private static function blocks(string $out): array
    {
        $padding = ':' . str_repeat(' ', 2048) . "\n\n";
        self::assertStringStartsWith($padding, $out);

        return array_values(array_filter(explode("\n\n", substr($out, strlen($padding))), static fn (string $b): bool => $b !== ''));
    }

    public function testOpeningPingsAndVoluntaryEnd(): void
    {
        $out = new BufferSseOutput();
        $start = $this->timer->now();
        $this->stream()->run(self::gmSub('session:1'), 0, $out, ['X-Request-Id' => 'r1']);

        self::assertSame('text/event-stream; charset=utf-8', $out->headers()['Content-Type']);
        self::assertSame('no-cache, no-transform', $out->headers()['Cache-Control']);
        self::assertSame('no', $out->headers()['X-Accel-Buffering']);
        self::assertSame('identity', $out->headers()['Content-Encoding']);
        self::assertSame('r1', $out->headers()['X-Request-Id']);
        $blocks = self::blocks($out->contents());
        self::assertSame('retry: 1500', $blocks[0]);
        self::assertSame(["event: ping\ndata: {}", "event: ping\ndata: {}", "event: ping\ndata: {}"], array_slice($blocks, 1), 'pings at 0, 10 and 20 s');
        self::assertEqualsWithDelta(25.0, $this->timer->now() - $start, 0.001, 'ends after 25 s');
    }

    public function testEventsAreFramedWithIdTypeAndFullJson(): void
    {
        $first = $this->write([['session:1', 'session.state', Audience::ALL, ['state' => 'running', 'current_map_id' => 3]]]);
        $later = 0;
        $start = $this->timer->now();
        $this->timer->onSleep = function (float $now) use ($start, &$later): void {
            if ($later === 0 && $now >= $start + 12) {
                $later = $this->write([['session:1', 'maptoken.moved', Audience::ALL, ['uid' => 't1', 'x' => 1.5, 'y' => 2]]]);
            }
        };
        $out = new BufferSseOutput();
        $this->stream()->run(self::gmSub('session:1'), 0, $out);
        $blocks = self::blocks($out->contents());
        $frames = array_values(array_filter($blocks, static fn (string $b): bool => str_starts_with($b, 'id: ')));
        self::assertCount(2, $frames);
        $lines = explode("\n", $frames[0]);
        self::assertSame(['id: ' . $first, 'event: session.state'], array_slice($lines, 0, 2));
        $data = json_decode(substr($lines[2], strlen('data: ')), true);
        self::assertSame((string) $first, $data['id']);
        self::assertSame('session:1', $data['channel']);
        self::assertSame(['state' => 'running', 'current_map_id' => '3'], $data['payload']);
        self::assertArrayHasKey('at', $data);
        self::assertStringStartsWith('id: ' . $later . "\nevent: maptoken.moved\ndata: {", $frames[1]);
        self::assertSame(['retry: 1500', "event: ping\ndata: {}"], array_slice($blocks, 0, 2));
        self::assertStringStartsWith('id: ' . $first, $blocks[2], 'waiting events right after the opening');
    }

    public function testInvisibleEventsMoveLastEventIdWithoutDispatch(): void
    {
        $this->write([['session:1', 'public', Audience::ALL, []]]);
        $secret = $this->write([['session:1', 'secret', Audience::GM, ['uid' => 'hidden-door']]]);
        $out = new BufferSseOutput();
        $this->stream()->run(self::sub(7, ['session:1' => Audience::ROLE_PLAYER]), 0, $out);
        self::assertStringNotContainsString('secret', $out->contents());
        self::assertStringNotContainsString('hidden-door', $out->contents());
        self::assertContains('id: ' . $secret, self::blocks($out->contents()), 'id-only block');
    }

    public function testGoneAtOpening(): void
    {
        $this->purgedUpto(50);
        $out = new BufferSseOutput();
        $start = $this->timer->now();
        $this->stream()->run(self::gmSub('session:1', 'map:2'), 10, $out);
        $blocks = self::blocks($out->contents());
        self::assertSame([
            'retry: 1500',
            "event: ping\ndata: {}",
            "event: events_gone\ndata: {\"channel\":\"session:1\"}",
            "event: events_gone\ndata: {\"channel\":\"map:2\"}",
        ], $blocks);
        self::assertSame($start, $this->timer->now(), 'ends at once');
    }

    public function testGoneDuringTheStream(): void
    {
        $start = $this->timer->now();
        $this->timer->onSleep = function (float $now) use ($start): void {
            if ($now >= $start + 4 && $now < $start + 4.2) {
                $this->purgedUpto(99);
            }
        };
        $out = new BufferSseOutput();
        $this->stream()->run(self::gmSub('session:1'), 5, $out);
        self::assertStringEndsWith("event: events_gone\ndata: {\"channel\":\"session:1\"}\n\n", $out->contents());
        $elapsed = $this->timer->now() - $start;
        self::assertGreaterThanOrEqual(5.0, $elapsed, 'found by the safety read (no signal)');
        self::assertLessThan(5.3, $elapsed);
    }

    public function testAbortedClientStopsTheLoop(): void
    {
        $out = new BufferSseOutput(1);
        $this->stream()->run(self::gmSub('session:1'), 0, $out);
        self::assertSame(0, $this->timer->sleeps);
    }

    public function testBacklogLargerThanOneReadIsStreamed(): void
    {
        $events = [];
        for ($i = 0; $i < 1203; $i++) {
            $events[] = ['session:1', 'bulk', Audience::ALL, ['n' => $i]];
        }
        $last = $this->write($events);
        $out = new BufferSseOutput();
        $this->stream()->run(self::gmSub('session:1'), 0, $out);
        self::assertSame(1203, substr_count($out->contents(), "event: bulk\n"));
        self::assertStringContainsString('id: ' . $last . "\n", $out->contents());
    }
}
