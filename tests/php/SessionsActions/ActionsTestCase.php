<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Sessions\SessionsTestCase;

/**
 * Tests of the session actions (P6c): helpers to send actions, read the events as a real client
 * (GET /events with the client's session) and build fog blocks.
 */
abstract class ActionsTestCase extends SessionsTestCase
{
    private int $actionOp = 0;

    protected function setUp(): void
    {
        parent::setUp();
        // Many actions per second in a test: the 30 / s bucket must not get in the way.
        $this->db->execute('DELETE FROM ' . $this->db->t('rate_limits'));
    }

    /**
     * POST /sessions/{id}/actions.
     *
     * @param list<array<string, mixed>> $actions
     */
    protected function act(ApiClient $client, string $sessionId, array $actions, ?string $opId = null): Response
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('rate_limits'));

        return $client->post('/sessions/' . $sessionId . '/actions', [
            'client_op_id' => $opId ?? 'act-' . (++$this->actionOp) . '-' . bin2hex(random_bytes(3)),
            'actions' => $actions,
        ]);
    }

    /**
     * Results of a successful batch.
     *
     * @param list<array<string, mixed>> $actions
     * @return list<array<string, mixed>>
     */
    protected function actOk(ApiClient $client, string $sessionId, array $actions): array
    {
        return self::data($this->ok($this->act($client, $sessionId, $actions)))['results'];
    }

    protected static function move(string $uid, int|float $x, int|float $y, ?int $rotation = null): array
    {
        return ['type' => 'token.move', 'uid' => $uid, 'x' => $x, 'y' => $y] + ($rotation === null ? [] : ['rotation' => $rotation]);
    }

    /**
     * Events a client receives on its channels after $since (GET /events, wait=0).
     *
     * @return list<array<string, mixed>>
     */
    protected function received(ApiClient $client, string $channels, int $since = 0): array
    {
        $out = [];
        do {
            $data = self::data($this->ok($client->get('/events?channels=' . rawurlencode($channels) . '&since=' . $since . '&wait=0')));
            foreach ($data['events'] as $e) {
                $out[] = $e;
            }
            $more = count($data['events']) === 500;
            $since = (int) $data['last_id'];
        } while ($more);

        return $out;
    }

    /**
     * "type" of the events a client receives.
     *
     * @return list<string>
     */
    protected function receivedTypes(ApiClient $client, string $channels, int $since = 0): array
    {
        return array_column($this->received($client, $channels, $since), 'type');
    }

    /**
     * Raw fog bitmap (2 048 bytes) with the sub-cells of the cells [x1, x2) x [y1, y2) of block
     * (cx, cy) set (cell coordinates relative to the map).
     */
    protected static function fogBits(int $cx, int $cy, int $x1, int $y1, int $x2, int $y2): string
    {
        $raw = str_repeat("\0", 2048);
        for ($sy = 0; $sy < 128; $sy++) {
            for ($sx = 0; $sx < 128; $sx++) {
                $x = $cx * 32 + $sx / 4;
                $y = $cy * 32 + $sy / 4;
                if ($x >= $x1 && $x < $x2 && $y >= $y1 && $y < $y2) {
                    $i = $sy * 128 + $sx;
                    $raw[$i >> 3] = chr(ord($raw[$i >> 3]) | (0x80 >> ($i & 7)));
                }
            }
        }

        return $raw;
    }

    protected static function b64(string $raw): string
    {
        return base64_encode(gzdeflate($raw, 6));
    }

    protected static function bitCount(string $raw): int
    {
        $n = 0;
        foreach (count_chars($raw, 1) as $byte => $count) {
            $n += substr_count(decbin($byte), '1') * $count;
        }

        return $n;
    }

    /**
     * Stored fog bitmap of a block (blank when absent).
     */
    protected function storedFog(string $mapId, string $floorId, int $cx, int $cy): string
    {
        $data = $this->db->fetchValue(
            'SELECT `data` FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ? AND `cx` = ? AND `cy` = ?',
            [(int) $mapId, (int) $floorId, $cx, $cy],
        );

        return $data === null ? str_repeat("\0", 2048) : (string) gzinflate((string) $data);
    }

    /**
     * @return array{x: float, y: float, rotation: int, rev: int, hidden: bool}
     */
    protected function placed(string $mapId, string $uid): array
    {
        $row = $this->db->fetchOne(
            'SELECT `x`, `y`, `rotation`, `rev`, `hidden` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? AND `uid` = ?',
            [(int) $mapId, $uid],
        );
        self::assertNotNull($row, $uid);

        return ['x' => (float) $row['x'], 'y' => (float) $row['y'], 'rotation' => (int) $row['rotation'], 'rev' => (int) $row['rev'], 'hidden' => (int) $row['hidden'] === 1];
    }

    protected function setSettings(array $w, array $settings): void
    {
        $this->ok($w['gm']->patch('/games/' . $w['game'], ['settings' => $settings]));
    }
}
