<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Displays\Display;
use JDR\Domain\Displays\DisplayAuth;
use JDR\Domain\Users\User;
use JDR\Realtime\BufferSseOutput;
use JDR\Realtime\ChannelAuthorizer;
use JDR\Realtime\LongPoll;
use JDR\Realtime\PhpSseOutput;
use JDR\Realtime\SseStream;
use JDR\Realtime\Subscription;

/**
 * Real-time reads (projet.md 10.3, contract P6a), both with the route option session_close:
 * - GET /events?channels=session:12,map:34&since=1200&wait=0..20 -> {events: [...], last_id};
 * - GET /stream?channels=…&since=… (or header Last-Event-ID) -> text/event-stream.
 * Channels: ChannelAuthorizer (422 invalid / more than 4, 403 not allowed, 404 unknown).
 * With ?as=display (route option display, P7b D7): the projection screen of the jdr_display cookie
 * reads the channel of its session (audiences all + displays); its loops end when it is revoked.
 */
final class RealtimeController
{
    private const ID_PATTERN = '/^(0|[1-9][0-9]{0,18})$/';

    public function __construct(
        private ChannelAuthorizer $authorizer,
        private LongPoll $longPoll,
        private SseStream $stream,
    ) {
    }

    public function events(Request $request): Response
    {
        $reader = DisplayAuth::of($request) ?? CurrentUser::require($request);
        $channels = ChannelAuthorizer::parse($request->query['channels'] ?? null);
        $since = self::cursor($request->query['since'] ?? null);
        $wait = self::wait($request->query['wait'] ?? null);
        $sub = $this->subscribe($request, $reader, $channels);

        return Response::ok($this->longPoll->poll($sub, $since, $wait)->toArray());
    }

    public function stream(Request $request): Response
    {
        $reader = DisplayAuth::of($request) ?? CurrentUser::require($request);
        $channels = ChannelAuthorizer::parse($request->query['channels'] ?? null);
        $header = trim((string) $request->header('Last-Event-ID'));
        // EventSource reconnects with the original URL: Last-Event-ID wins over ?since=.
        $since = preg_match(self::ID_PATTERN, $header) === 1 && self::fitsInt($header)
            ? (int) $header
            : self::cursor($request->query['since'] ?? null);
        $sub = $this->subscribe($request, $reader, $channels);
        $extra = ['X-Content-Type-Options' => 'nosniff', 'X-Request-Id' => $request->id];

        if (PHP_SAPI === 'cli') {
            $out = new BufferSseOutput();
            $this->stream->run($sub, $since, $out, $extra);

            return new Response($out->contents(), 200, $out->headers());
        }
        $this->stream->run($sub, $since, new PhpSseOutput(), $extra);

        return new Response('', 200, SseStream::HEADERS + $extra);
    }

    /**
     * @param list<string> $channels
     */
    private function subscribe(Request $request, User|Display $reader, array $channels): Subscription
    {
        if ($reader instanceof Display) {
            $ua = $request->header('user-agent');

            return $this->authorizer->authorizeDisplay(
                $reader->id,
                $reader->sessionId,
                $channels,
                $request->ip() === '' ? null : substr($request->ip(), 0, 45),
                $ua === null || $ua === '' ? null : mb_substr($ua, 0, 255, 'UTF-8'),
            );
        }

        return $this->authorizer->authorize($reader->id, $channels);
    }

    private static function cursor(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return 0;
        }
        if (!is_string($raw) || preg_match(self::ID_PATTERN, $raw) !== 1 || !self::fitsInt($raw)) {
            throw new ValidationException('', ['since' => 'invalid']);
        }

        return (int) $raw;
    }

    private static function wait(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return 0;
        }
        $wait = is_string($raw) ? filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => LongPoll::MAX_WAIT_S]]) : false;
        if ($wait === false) {
            throw new ValidationException('', ['wait' => 'invalid']);
        }

        return $wait;
    }

    private static function fitsInt(string $digits): bool
    {
        return strlen($digits) < 19 || strcmp($digits, (string) PHP_INT_MAX) <= 0;
    }
}
