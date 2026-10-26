<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

/**
 * Two real PHP processes editing the objects of one map (projet.md 11.4 and 21): the map row
 * lock serializes the lots; every add is kept; concurrent updates of the same object based on
 * the same rev are applied once, the others come back as "stale" conflicts with the current
 * object; no update is lost or applied twice (final rev = 1 + applied updates).
 */
final class MapSceneConcurrencyTest extends MapsP5TestCase
{
    private const LOTS = 25;

    public function testTwoProcessesUpdatingTheSameObject(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $this->opsOk($gm, $map['id'], [self::addObject(self::wall('shared', $f))]);
        $barrier = sys_get_temp_dir() . '/jdr-scene-barrier-' . bin2hex(random_bytes(4));
        $worker = __DIR__ . '/fixtures/scene-worker.php';
        $procs = [];
        foreach ([0, 1] as $w) {
            $args = json_encode([
                'db' => self::dbConfig(),
                'root' => self::projectRoot(),
                'map_id' => (int) $map['id'],
                'floor_id' => (int) $f,
                'user_id' => $this->userId('Alice'),
                'worker' => $w,
                'lots' => self::LOTS,
                'barrier' => $barrier,
            ], JSON_THROW_ON_ERROR);
            $proc = proc_open([PHP_BINARY, $worker, $args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            self::assertIsResource($proc);
            $procs[$w] = [$proc, $pipes];
        }
        usleep(300_000);
        touch($barrier);

        $revisions = [];
        $updates = 0;
        $stale = 0;
        try {
            foreach ($procs as $w => [$proc, $pipes]) {
                $out = (string) stream_get_contents($pipes[1]);
                $err = (string) stream_get_contents($pipes[2]);
                fclose($pipes[1]);
                fclose($pipes[2]);
                self::assertSame(0, proc_close($proc), 'worker ' . $w . ': ' . $err . $out);
                $lines = array_values(array_filter(explode("\n", $out)));
                self::assertCount(self::LOTS, $lines, 'worker ' . $w . ': ' . $err);
                foreach ($lines as $line) {
                    $r = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
                    $revisions[] = $r['revision'];
                    if ($r['conflicts'] === []) {
                        self::assertSame(2, $r['applied']);
                        $updates++;
                    } else {
                        self::assertSame(1, $r['applied']);
                        self::assertCount(1, $r['conflicts']);
                        self::assertSame(['op_index' => 1, 'kind' => 'object', 'uid' => 'shared', 'reason' => 'stale'], array_slice($r['conflicts'][0], 0, 4));
                        self::assertGreaterThan($r['sent_rev'], $r['conflicts'][0]['current']['rev']);
                        $stale++;
                    }
                }
            }
        } finally {
            @unlink($barrier);
        }
        sort($revisions);
        self::assertSame(range(2, 1 + 2 * self::LOTS), $revisions, 'one revision per lot, none lost or shared');
        self::assertSame(2 * self::LOTS, $updates + $stale);
        self::assertGreaterThan(0, $updates);
        $objects = $this->objectsOf($gm, $map['id']);
        self::assertSame(1 + $updates, $objects['shared']['rev'], 'every applied update counted once');
        self::assertCount(1 + 2 * self::LOTS, $objects, 'every add is kept');
    }
}
