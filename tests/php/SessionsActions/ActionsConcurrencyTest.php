<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * Three real PHP processes on one played map: Bob moving his elf, the GM moving a goblin (both
 * actions, with the D3 merge) and the GM editing the map (ops, D10). Lock order session -> map ->
 * event_seq: no deadlock left unresolved, every request answered, the last stored positions are
 * the last ones sent and the last maptoken.moved events (never edited, only merged) carry them.
 */
final class ActionsConcurrencyTest extends ActionsTestCase
{
    private const LOTS = 20;

    public function testMovesAndOpsTogether(): void
    {
        $w = $this->bigScene();
        $barrier = sys_get_temp_dir() . '/jdr-actions-barrier-' . bin2hex(random_bytes(4));
        $workers = [
            ['mode' => 'move', 'user' => 'Bob', 'uid' => 't-elf'],
            ['mode' => 'move', 'user' => 'Alice', 'uid' => 't-goblin'],
            ['mode' => 'ops', 'user' => 'Alice', 'uid' => null],
        ];
        $procs = [];
        foreach ($workers as $i => $spec) {
            $args = json_encode([
                'db' => self::dbConfig(), 'root' => self::projectRoot(), 'session_id' => (int) $w['session'], 'map_id' => (int) $w['big'],
                'floor_id' => (int) $w['bigFloor'], 'user_id' => $this->userId($spec['user']), 'worker' => $i, 'mode' => $spec['mode'],
                'uid' => $spec['uid'], 'lots' => self::LOTS, 'barrier' => $barrier,
            ], JSON_THROW_ON_ERROR);
            $proc = proc_open([PHP_BINARY, __DIR__ . '/fixtures/actions-worker.php', $args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            self::assertIsResource($proc);
            $procs[$i] = [$proc, $pipes];
        }
        usleep(300_000);
        touch($barrier);
        try {
            foreach ($procs as $i => [$proc, $pipes]) {
                $out = (string) stream_get_contents($pipes[1]);
                $err = (string) stream_get_contents($pipes[2]);
                fclose($pipes[1]);
                fclose($pipes[2]);
                self::assertSame(0, proc_close($proc), 'worker ' . $i . ': ' . $err . $out);
                self::assertCount(self::LOTS, array_filter(explode("\n", $out)), 'worker ' . $i . ': ' . $err);
            }
        } finally {
            @unlink($barrier);
        }
        $last = 10 + self::LOTS - 1;
        self::assertSame((float) $last, $this->placed($w['big'], 't-elf')['x']);
        self::assertSame((float) $last, $this->placed($w['big'], 't-goblin')['x']);
        $gmMoves = array_values(array_filter($this->events(), static fn (array $e): bool => $e['type'] === 'maptoken.moved' && $e['audience'] === 'gm'));
        foreach (['t-elf', 't-goblin'] as $uid) {
            $mine = array_values(array_filter($gmMoves, static fn (array $e): bool => $e['payload']['uid'] === $uid));
            self::assertNotSame([], $mine);
            self::assertEquals($last, $mine[count($mine) - 1]['payload']['x'], $uid . ': the last event has the last position');
        }
        self::assertSame(self::LOTS, (int) $this->db->fetchValue('SELECT COUNT(*) FROM ' . $this->db->t('events') . " WHERE `type` = 'map.ops'"));
        $ids = array_column($this->events(), 'id');
        self::assertSame($ids, array_values(array_unique($ids)));
    }
}
