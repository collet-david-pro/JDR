<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\SessionsActions\ActionsTestCase;

/**
 * API tests of the notes, pins, zones, traps and secrets (etapes P09 D3, D4).
 */
abstract class MapsP9bTestCase extends ActionsTestCase
{
    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function note(string $uid, array $over = []): array
    {
        return array_replace(['uid' => $uid, 'title' => 'Titre ' . $uid, 'body' => 'Corps ' . $uid], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function addNote(string $uid, array $over = []): array
    {
        return ['type' => 'note.add', 'note' => self::note($uid, $over)];
    }

    /**
     * @param array<string, mixed> $over members of the object; $over['props'] replaces the props
     * @return array<string, mixed>
     */
    protected static function pin(string $uid, string $floor, ?string $note = null, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'pin',
            'geometry' => ['x' => 6, 'y' => 6],
            'props' => ['icon' => 'place', 'color' => '#ff0000', 'note' => $note],
        ], $over);
    }

    /**
     * @param list<array{x: int|float, y: int|float}> $polygon
     * @param array<string, mixed>                    $over
     * @return array<string, mixed>
     */
    protected static function zone(string $uid, string $floor, array $polygon, ?string $note = null, bool $onEnter = true, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'zone',
            'geometry' => ['polygon' => $polygon],
            'props' => ['kind' => 'description', 'note' => $note, 'show_on_enter' => $onEnter],
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function trap(string $uid, string $floor, ?string $note = null, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'trap',
            'geometry' => ['x' => 7, 'y' => 7],
            'props' => ['note' => $note, 'reveal_effect' => 'pulse'],
        ], $over);
    }

    /**
     * @param array{0: int|float, 1: int|float} $a
     * @param array{0: int|float, 1: int|float} $b
     * @param array<string, mixed>              $over
     * @return array<string, mixed>
     */
    protected static function passage(string $uid, string $floor, array $a, array $b, ?string $note = null, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'secret',
            'geometry' => ['a' => $a, 'b' => $b],
            'props' => ['kind' => 'passage', 'note' => $note],
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function room(string $uid, string $floor, ?string $note = null, string $kind = 'room', array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'secret',
            'geometry' => ['polygon' => self::square(8, 8, 2)],
            'props' => ['kind' => $kind, 'note' => $note],
        ], $over);
    }

    /**
     * @return list<array{x: int|float, y: int|float}>
     */
    protected static function square(int|float $x, int|float $y, int|float $size): array
    {
        return [['x' => $x, 'y' => $y], ['x' => $x + $size, 'y' => $y], ['x' => $x + $size, 'y' => $y + $size], ['x' => $x, 'y' => $y + $size]];
    }

    /**
     * @param array<string, mixed> $object
     * @return array<string, mixed>
     */
    protected static function add(array $object): array
    {
        return ['type' => 'object.add', 'object' => $object];
    }

    /**
     * @param list<array<string, mixed>> $ops
     * @param array<string, string>      $errors
     */
    protected function opsFail(ApiClient $client, string $mapId, array $ops, array $errors): Response
    {
        $before = $this->revision($mapId);
        $response = $this->sendOps($client, $mapId, $ops);
        self::assertFieldErrors($response, $errors);
        self::assertSame($before, $this->revision($mapId), 'a refused lot changes nothing');

        return $response;
    }

    /**
     * @return array<string, array<string, mixed>> by uid
     */
    protected function notesOf(ApiClient $client, string $mapId): array
    {
        return array_column(self::data($this->ok($client->get('/maps/' . $mapId)))['notes'], null, 'uid');
    }

    /**
     * @return array<string, array<string, mixed>> by uid
     */
    protected function objectsById(ApiClient $client, string $mapId): array
    {
        return array_column(self::data($this->ok($client->get('/maps/' . $mapId)))['objects'], null, 'uid');
    }

    /**
     * The state of a client: snapshot of a running session (?as=display for a screen).
     *
     * @return array<string, mixed>
     */
    protected function snap(ApiClient $client, string $sessionId, bool $display = false): array
    {
        return self::data($this->ok($client->get('/sessions/' . $sessionId . '/snapshot' . ($display ? '?as=display' : ''))));
    }

    /**
     * uids of the objects in a snapshot, sorted.
     *
     * @param array<string, mixed> $snapshot
     * @return list<string>
     */
    protected static function objectUids(array $snapshot, string $prefix = ''): array
    {
        $uids = array_values(array_filter(
            array_column($snapshot['map']['objects'], 'uid'),
            static fn (string $uid): bool => $prefix === '' || str_starts_with($uid, $prefix),
        ));
        sort($uids);

        return $uids;
    }

    /**
     * A projection screen paired to the session.
     */
    protected function screen(ApiClient $gm, string $sessionId, string $ip): ApiClient
    {
        $display = self::data($this->ok($gm->post('/sessions/' . $sessionId . '/displays', ['name' => 'Écran ' . $ip]), 201));
        $screen = $this->client($ip);
        $this->ok($screen->get('/auth/me'));
        $this->ok($screen->post('/display/pair', ['code' => $display['pairing']['code']]));

        return $screen;
    }

    /**
     * Events a screen reads after $since.
     *
     * @return list<array<string, mixed>>
     */
    protected function receivedByScreen(ApiClient $screen, string $channels, int $since = 0): array
    {
        $out = [];
        do {
            $data = self::data($this->ok($screen->get('/events?as=display&channels=' . rawurlencode($channels) . '&since=' . $since . '&wait=0')));
            foreach ($data['events'] as $e) {
                $out[] = $e;
            }
            $since = (int) $data['last_id'];
        } while (count($data['events']) === 500);

        return $out;
    }

    /**
     * Events of the given types among $events: [type, payload without view].
     *
     * @param list<array<string, mixed>> $events
     * @param list<string>               $types
     * @return list<array{0: string, 1: array<string, mixed>}>
     */
    protected static function only(array $events, array $types): array
    {
        $out = [];
        foreach ($events as $e) {
            if (in_array($e['type'], $types, true)) {
                $payload = $e['payload'];
                unset($payload['view']);
                $out[] = [$e['type'], $payload];
            }
        }

        return $out;
    }

    /**
     * GET /maps/{id}/export (JSON) decoded.
     *
     * @return array<string, mixed>
     */
    protected function exportDoc(ApiClient $client, string $mapId): array
    {
        return json_decode($this->ok($client->get('/maps/' . $mapId . '/export'))->body(), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * POST /games/{id}/maps/import of a JSON document.
     *
     * @param array<string, mixed> $doc
     */
    protected function importDoc(ApiClient $client, string $gameId, array $doc): Response
    {
        $file = tempnam(sys_get_temp_dir(), 'jdr-p9b-');
        self::assertIsString($file);
        file_put_contents($file, json_encode($doc, JSON_THROW_ON_ERROR));
        try {
            return $client->upload('/games/' . $gameId . '/maps/import', $file, [], 'map.json');
        } finally {
            @unlink($file);
        }
    }

    protected function noteRow(string $mapId, string $uid): ?array
    {
        return $this->db->fetchOne('SELECT * FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $mapId, $uid]);
    }

    protected function objectRow(string $mapId, string $uid): ?array
    {
        return $this->db->fetchOne('SELECT * FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $mapId, $uid]);
    }
}
