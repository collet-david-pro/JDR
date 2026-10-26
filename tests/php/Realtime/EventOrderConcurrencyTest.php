<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Realtime\EventReader;

/**
 * D1 with two real PHP processes: a slow transaction gets its event id, then waits 1.5 s before
 * COMMIT; a fast one writes an event meanwhile. A reader polling "id > since" every 10 ms must
 * see every event.
 * - control (naive INSERT, the P0 behaviour): the fast event (higher id) is visible first, the
 *   reader moves past it and SKIPS the slow one — the test does detect the problem;
 * - EventStore: the fast writer waits on the event_seq lock until the slow one commits, ids
 *   become visible in order, nothing is skipped.
 */
final class EventOrderConcurrencyTest extends RealtimeTestCase
{
    private const HOLD_MS = 1500;

    public function testNaiveInsertsLetAReaderSkipAnEvent(): void
    {
        $run = $this->race('naive');
        self::assertGreaterThan($run['slow']['id'], $run['fast']['id'], 'the slow transaction took the lower id');
        self::assertLessThan($run['slow']['committed'], $run['fast']['committed'], 'the fast one committed first');
        self::assertSame([$run['slow']['id']], $run['skipped'], 'the reader skipped the slow event');
    }

    public function testEventStoreMakesIdsVisibleInOrder(): void
    {
        $run = $this->race('store');
        self::assertGreaterThan($run['slow']['id'], $run['fast']['id']);
        self::assertGreaterThanOrEqual($run['slow']['committed'], $run['fast']['committed'], 'the fast writer waited for the slow COMMIT');
        self::assertGreaterThan(1.0, $run['fast']['committed'] - $run['fast']['started'], 'blocked on the event_seq lock');
        self::assertSame([], $run['skipped'], 'no event skipped');
        self::assertSame([$run['slow']['id'], $run['fast']['id']], $run['seen'], 'seen once each, in id order');
    }

    /**
     * @return array{slow: array{id: int, started: float, committed: float}, fast: array{id: int, started: float, committed: float}, seen: list<int>, skipped: list<int>}
     */
    private function race(string $mode): array
    {
        $tag = bin2hex(random_bytes(4));
        $flushed = sys_get_temp_dir() . '/jdr-ev-flushed-' . $tag;
        $base = ['db' => self::dbConfig(), 'root' => self::projectRoot(), 'storage' => self::$root . '/storage', 'mode' => $mode, 'channel' => 'session:1'];
        try {
            $slow = $this->spawn($base + ['type' => 'slow', 'hold_ms' => self::HOLD_MS, 'flushed' => $flushed]);
            $fast = $this->spawn($base + ['type' => 'fast', 'hold_ms' => 0, 'wait_for' => $flushed]);

            $reader = $this->app->container()->get(EventReader::class);
            $sub = self::gmSub('session:1');
            $since = 0;
            $seen = [];
            $limit = microtime(true) + 20;
            do {
                $running = $this->running($slow) || $this->running($fast);
                foreach ($reader->read($sub, $since)->events as $event) {
                    $seen[] = $event->id;
                    $since = max($since, $event->id);
                }
                usleep(10_000);
            } while ($running && microtime(true) < $limit);
            $slowOut = $this->finish($slow);
            $fastOut = $this->finish($fast);
        } finally {
            @unlink($flushed);
        }
        $all = array_map('intval', array_column($this->db->fetchAll('SELECT `id` FROM ' . $this->db->t('events') . ' ORDER BY `id`'), 'id'));
        self::assertSame([$slowOut['id'], $fastOut['id']], array_values(array_intersect($all, [$slowOut['id'], $fastOut['id']])));

        return [
            'slow' => $slowOut,
            'fast' => $fastOut,
            'seen' => $seen,
            'skipped' => array_values(array_diff($all, $seen)),
        ];
    }

    /**
     * @param array<string, mixed> $args
     * @return array{0: resource, 1: array<int, resource>}
     */
    private function spawn(array $args): array
    {
        $proc = proc_open(
            [PHP_BINARY, __DIR__ . '/fixtures/event-writer.php', json_encode($args, JSON_THROW_ON_ERROR)],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        self::assertIsResource($proc);

        return [$proc, $pipes];
    }

    /**
     * @param array{0: resource, 1: array<int, resource>} $p
     */
    private function running(array $p): bool
    {
        return proc_get_status($p[0])['running'];
    }

    /**
     * @param array{0: resource, 1: array<int, resource>} $p
     * @return array{id: int, started: float, committed: float}
     */
    private function finish(array $p): array
    {
        [$proc, $pipes] = $p;
        $out = (string) stream_get_contents($pipes[1]);
        $err = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $status = proc_close($proc);
        $data = json_decode(trim($out), true);
        self::assertIsArray($data, 'worker output: ' . $out . $err . ' (exit ' . $status . ')');

        return ['id' => (int) $data['id'], 'started' => (float) $data['started'], 'committed' => (float) $data['committed']];
    }
}
