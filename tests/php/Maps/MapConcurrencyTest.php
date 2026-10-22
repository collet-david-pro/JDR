<?php

declare(strict_types=1);

namespace JDR\Tests\Maps;

/**
 * Concurrent ops on one map from two real PHP processes (projet.md 11.4 and 21): the map row
 * lock serializes the lots, so nothing is lost, revisions are consecutive, the chunks hold
 * every write and map_asset_refs matches a full recount.
 */
final class MapConcurrencyTest extends MapsTestCase
{
    private const LOTS = 30;

    public function testTwoProcessesWritingTheSameMap(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $floor, 'a' => $a, 'b' => $b] = $this->scene(['width' => 64, 'height' => 80]);
        self::assertSame(1, $this->revision($map['id']));
        $barrier = sys_get_temp_dir() . '/jdr-ops-barrier-' . bin2hex(random_bytes(4));
        $worker = __DIR__ . '/fixtures/ops-worker.php';

        $procs = [];
        foreach ([0, 1] as $w) {
            $args = json_encode([
                'db' => self::dbConfig(),
                'root' => self::projectRoot(),
                'map_id' => (int) $map['id'],
                'floor_id' => (int) $floor,
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
        try {
            foreach ($procs as $w => [$proc, $pipes]) {
                $out = (string) stream_get_contents($pipes[1]);
                $err = (string) stream_get_contents($pipes[2]);
                fclose($pipes[1]);
                fclose($pipes[2]);
                self::assertSame(0, proc_close($proc), 'worker ' . $w . ': ' . $err . $out);
                $lines = array_values(array_filter(explode("\n", $out)));
                self::assertCount(self::LOTS, $lines, 'worker ' . $w . ': ' . $err);
                $previous = 0;
                foreach ($lines as $line) {
                    $result = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
                    self::assertSame(2, $result['applied']);
                    self::assertSame([], $result['conflicts']);
                    self::assertGreaterThan($previous, $result['revision'], 'revisions grow for each process');
                    $previous = $result['revision'];
                    $revisions[] = $result['revision'];
                }
            }
        } finally {
            @unlink($barrier);
        }

        sort($revisions);
        self::assertSame(range(2, 1 + 2 * self::LOTS), $revisions, 'consecutive revisions, none lost or shared');
        self::assertSame(1 + 2 * self::LOTS, $this->revision($map['id']));

        $cells = $this->storedCells($map['id']);
        $expected = [];
        for ($lot = 0; $lot < self::LOTS; $lot++) {
            foreach ([0, 1] as $w) {
                for ($x = 0; $x < 64; $x++) {
                    $expected[$floor . '|ground|' . $x . ',' . (2 * $lot + $w)] = [1 + $w, $lot, $w];
                }
            }
        }
        $contested = $cells[$floor . '|terrain|5,70'] ?? null;
        unset($cells[$floor . '|terrain|5,70']);
        ksort($expected);
        self::assertSame($expected, $cells, 'every write of both processes is stored');
        self::assertContains($contested, [[1, self::LOTS - 1, 0], [2, self::LOTS - 1, 0]], 'last writer wins on the contested cell');

        $refs = $this->storedRefs($map['id']);
        self::assertSame($this->recountRefs($map['id']), $refs);
        self::assertSame(64 * self::LOTS * 2 + 1, array_sum($refs));
        self::assertSame(64 * self::LOTS + ($contested[0] === 1 ? 1 : 0), $refs[(int) $a['id']]);
        self::assertSame(64 * self::LOTS + ($contested[0] === 2 ? 1 : 0), $refs[(int) $b['id']]);

        // Chunk revisions never exceed the map revision; the API agrees with the database.
        $max = (int) $this->db->fetchValue('SELECT MAX(`revision`) FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ?', [(int) $map['id']]);
        self::assertLessThanOrEqual(1 + 2 * self::LOTS, $max);
        self::assertSame((string) (1 + 2 * self::LOTS), $gm->get('/maps/' . $map['id'] . '/chunks')->header('X-Map-Revision'));

        // A replayed lot of a worker returns its remembered response.
        $replay = $this->sendOps($gm, $map['id'], [], 0, 'w1-lot-0');
        self::assertSame(200, $replay->status(), $replay->body());
        self::assertContains(self::data($replay)['revision'], range(2, 1 + 2 * self::LOTS));
        self::assertSame(2, self::data($replay)['applied']);
        self::assertSame(1 + 2 * self::LOTS, $this->revision($map['id']));
    }
}
