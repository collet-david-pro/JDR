<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\GoneException;
use JDR\Core\Response;

/**
 * GET /stream (projet.md 10.3, transport 1), contract P6a:
 * - 2 KB comment (proxies flush their buffer), "retry: 1500", then a first ping;
 * - every 250 ms: witnesses tested, MySQL read when one changed (plus every 5 s); each visible
 *   event => "id: <id>" / "event: <type>" / "data: <full event JSON>";
 * - when the cursor moved past events of another audience, an "id:"-only block moves the
 *   browser's Last-Event-ID without dispatching anything;
 * - "event: ping" every 10 s (a named event, not a comment: EventSource never exposes
 *   comments and the client uses pings to detect a buffering proxy);
 * - voluntary end after 25 s (the browser reconnects with Last-Event-ID);
 * - since < purge mark (at opening or later) => "event: events_gone" + data {"channel": …}
 *   for each channel, then end.
 */
final class SseStream
{
    public const DURATION_S = 25;
    public const PING_S = 10;
    public const TICK_US = 250_000;
    public const RETRY_MS = 1500;
    public const PADDING_BYTES = 2048;
    /** Reads of 500 events in a row before giving the loop back (huge backlog). */
    private const MAX_ROUNDS = 10;

    public const HEADERS = [
        'Content-Type' => 'text/event-stream; charset=utf-8',
        'Cache-Control' => 'no-cache, no-transform',
        'X-Accel-Buffering' => 'no',
        'Content-Encoding' => 'identity',
    ];

    public function __construct(
        private EventReader $reader,
        private ChannelSignal $signal,
        private Timer $timer,
        private LoopListeners $listeners,
    ) {
    }

    /**
     * Streams until the deadline, the client leaving or events_gone.
     *
     * @param array<string, string> $extraHeaders
     */
    public function run(Subscription $sub, int $since, SseOutput $out, array $extraHeaders = []): void
    {
        $out->start(self::HEADERS + $extraHeaders);
        $out->write(':' . str_repeat(' ', self::PADDING_BYTES) . "\n\n");
        $out->write('retry: ' . self::RETRY_MS . "\n\n");
        $out->write(self::ping());
        $out->flush();

        $watch = new ChannelWatch($this->signal, $this->timer, $sub->channels());
        $watch->start();
        $start = $this->timer->now();
        $deadline = $start + self::DURATION_S;
        $lastPing = $start;
        $first = true;
        while (!$out->aborted()) {
            $this->listeners->tick($sub, $this->timer->now());
            if ($first || $watch->shouldRead()) {
                try {
                    // A backlog left by the round limit is read again at the next tick.
                    [$since, $first] = $this->drain($sub, $since, $out);
                } catch (GoneException) {
                    foreach ($sub->channels() as $channel) {
                        $out->write("event: events_gone\ndata: " . json_encode(['channel' => $channel], Response::JSON_FLAGS) . "\n\n");
                    }
                    $out->flush();

                    return;
                }
            }
            $now = $this->timer->now();
            if ($now >= $deadline) {
                break;
            }
            if ($now - $lastPing >= self::PING_S) {
                $out->write(self::ping());
                $out->flush();
                $lastPing = $now;
            }
            $this->timer->sleep((int) min(self::TICK_US, ceil(($deadline - $now) * 1_000_000)));
        }
    }

    /**
     * Writes every visible event after $since.
     *
     * @return array{0: int, 1: bool} [new cursor, backlog left]
     */
    private function drain(Subscription $sub, int $since, SseOutput $out): array
    {
        $written = false;
        $lastSent = $since;
        $rounds = 0;
        do {
            $result = $this->reader->read($sub, $since);
            foreach ($result->events as $event) {
                $out->write(self::frame($event));
                $lastSent = $event->id;
                $written = true;
            }
            $since = $result->lastId;
            $rounds++;
        } while ($result->more && $rounds < self::MAX_ROUNDS);
        if ($since > $lastSent) {
            $out->write('id: ' . $since . "\n\n");
            $written = true;
        }
        if ($written) {
            $out->flush();
        }

        return [$since, $result->more];
    }

    public static function frame(WireEvent $event): string
    {
        return 'id: ' . $event->id . "\nevent: " . $event->type . "\ndata: " . $event->toJson() . "\n\n";
    }

    private static function ping(): string
    {
        return "event: ping\ndata: {}\n\n";
    }
}
