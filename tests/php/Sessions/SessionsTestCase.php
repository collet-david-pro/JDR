<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Realtime\RealtimeTestCase;

/**
 * Tests of the sessions (P6b): a world with GM Alice, co-GM Carl, players Bob / Kim, member Dan
 * (never in the session), outsider Eve and an anonymous client; helpers to read the events.
 */
abstract class SessionsTestCase extends RealtimeTestCase
{
    private int $loginIp = 20;

    protected function loginAs(string $username): ApiClient
    {
        $client = $this->client('192.0.2.' . (++$this->loginIp));
        $client->login($username, self::PASSWORD);

        return $client;
    }

    /**
     * Game with a map; Bob and Kim have joined the session (lobby) and Kim was kicked.
     *
     * @return array{gm: ApiClient, co: ApiClient, bob: ApiClient, kim: ApiClient, dan: ApiClient, eve: ApiClient,
     *     anon: ApiClient, game: string, map: string, floor: string, session: string, code: string, channel: string}
     */
    protected function arena(bool $kimKicked = true): array
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $map = $this->newMap($gm, $game);
        foreach ([['Carl', 'co_gm'], ['Bob', 'player'], ['Kim', 'player'], ['Dan', 'player']] as [$name, $role]) {
            $this->addMember($gm, $game, $name, $role);
        }
        $this->createUser('Eve');
        $session = self::data($this->ok($gm->post('/games/' . $game . '/sessions', ['name' => 'Séance 1', 'map_id' => $map['id']]), 201));
        $code = (string) $session['code'];
        $bob = $this->loginAs('Bob');
        $kim = $this->loginAs('Kim');
        $this->ok($bob->post('/sessions/join', ['code' => $code]));
        $this->ok($kim->post('/sessions/join', ['code' => $code]));
        if ($kimKicked) {
            $this->ok($gm->post('/sessions/' . $session['id'] . '/kick', ['user_id' => (string) $this->userId('Kim')]), 204);
        }

        return [
            'gm' => $gm,
            'co' => $this->loginAs('Carl'),
            'bob' => $bob,
            'kim' => $kim,
            'dan' => $this->loginAs('Dan'),
            'eve' => $this->loginAs('Eve'),
            'anon' => $this->client('192.0.2.250'),
            'game' => $game,
            'map' => (string) $map['id'],
            'floor' => (string) $map['floors'][0]['id'],
            'session' => (string) $session['id'],
            'code' => $code,
            'channel' => 'session:' . $session['id'],
        ];
    }

    protected function ok(Response $response, int $status = 200): Response
    {
        self::assertSame($status, $response->status(), $response->body());

        return $response;
    }

    protected function state(string $sessionId): string
    {
        return (string) $this->db->fetchValue('SELECT `state` FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ?', [(int) $sessionId]);
    }

    protected function setState(string $sessionId, string $state): void
    {
        $this->db->execute('UPDATE ' . $this->db->t('play_sessions') . ' SET `state` = ? WHERE `id` = ?', [$state, (int) $sessionId]);
    }

    /**
     * Raw events of the log after $after: id, channel, type, audience, audience_user_id, payload (array),
     * actor_user_id, client_op_id.
     *
     * @return list<array<string, mixed>>
     */
    protected function events(int $after = 0, ?string $channel = null): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . $this->db->t('events') . ' WHERE `id` > ?' . ($channel === null ? '' : ' AND `channel` = ?') . ' ORDER BY `id`',
            $channel === null ? [$after] : [$after, $channel],
        );

        return array_map(static function (array $r): array {
            $r['id'] = (int) $r['id'];
            $r['payload'] = json_decode((string) $r['payload'], true);

            return $r;
        }, $rows);
    }

    protected function head(): int
    {
        return (int) $this->db->fetchValue('SELECT COALESCE(MAX(`id`), 0) FROM ' . $this->db->t('events'));
    }

    /**
     * "type/audience" of the events after $after, in order.
     *
     * @return list<string>
     */
    protected function kinds(int $after, ?string $channel = null): array
    {
        return array_map(static fn (array $e): string => $e['type'] . '/' . $e['audience'], $this->events($after, $channel));
    }

    protected function playerStatus(string $sessionId, string $username): ?string
    {
        $v = $this->db->fetchValue(
            'SELECT `status` FROM ' . $this->db->t('session_players') . ' WHERE `session_id` = ? AND `user_id` = ?',
            [(int) $sessionId, $this->userId($username)],
        );

        return $v === null ? null : (string) $v;
    }

    protected function isReady(string $sessionId, string $username): bool
    {
        return (int) $this->db->fetchValue(
            'SELECT `ready` FROM ' . $this->db->t('session_players') . ' WHERE `session_id` = ? AND `user_id` = ?',
            [(int) $sessionId, $this->userId($username)],
        ) === 1;
    }

    protected function startSession(array $w): void
    {
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/start'));
    }

    /**
     * A 200 x 200 map in a running session: Bob owns the elf at (5, 5), Dan the dwarf at (9, 9);
     * walls, a secret door, gm / hidden objects near; a far wall, a far goblin and a far tile.
     * Bob is in the session since arena(); Dan joins here.
     *
     * @return array<string, mixed>
     */
    protected function bigScene(bool $start = true): array
    {
        $w = $this->arena();
        $gm = $w['gm'];
        $big = $this->newMap($gm, $w['game'], ['name' => 'Grande', 'width' => 200, 'height' => 200]);
        $floor = (string) $big['floors'][0]['id'];
        $this->ok($gm->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $big['id'], 'floor_id' => $floor]));
        $a = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $b = $this->uploadOk($gm, 'valid_png_transparent.png', ['kind' => 'tile']);
        $img = $this->uploadOk($gm, 'valid_gif_static.gif', ['kind' => 'token']);
        $this->opsOk($gm, $big['id'], [
            self::paletteAdd(1, $a['id']),
            self::paletteAdd(2, $b['id']),
            self::tiles($floor, 'ground', [[3, 3, 1], [150, 150, 2]]),
        ]);
        $elf = $this->newToken($gm, $w['game'], ['name' => 'Elfe', 'kind' => 'pc', 'asset_id' => $img['id']]);
        $dwarf = $this->newToken($gm, $w['game'], ['name' => 'Nain', 'kind' => 'pc']);
        $goblin = $this->newToken($gm, $w['game'], ['name' => 'Gobelin', 'kind' => 'monster']);
        $dragon = $this->newToken($gm, $w['game'], ['name' => 'Dragon', 'kind' => 'monster']);
        $this->fill($gm, (string) $big['id'], [
            self::wallObject('wall-near', $floor, [[2, 2], [10, 2]]),
            self::wallObject('wall-far', $floor, [[180, 180], [190, 180]]),
            self::doorObject('door-secret', $floor, [12, 2], [13, 2], true),
            self::doorObject('door-plain', $floor, [14, 2], [15, 2]),
            self::wallObject('gm-layer', $floor, [[3, 3], [4, 3]], ['layer' => 'gm']),
            self::wallObject('gm-vis', $floor, [[5, 3], [6, 3]], ['visibility' => 'gm']),
            self::wallObject('hidden-vis', $floor, [[7, 3], [8, 3]], ['visibility' => 'hidden_until_revealed']),
        ], [
            self::placedToken('t-elf', $floor, (string) $elf['id'], 5, 5),
            self::placedToken('t-dwarf', $floor, (string) $dwarf['id'], 9, 9),
            self::placedToken('t-goblin', $floor, (string) $goblin['id'], 8, 5),
            self::placedToken('t-goblin-far', $floor, (string) $goblin['id'], 170, 170),
            self::placedToken('t-dragon', $floor, (string) $dragon['id'], 6, 6, ['hidden' => true]),
        ]);
        $this->ok($w['dan']->post('/sessions/join', ['code' => $w['code']]));
        $path = '/sessions/' . $w['session'] . '/assignments/';
        $this->ok($gm->put($path . $elf['id'], ['user_id' => (string) $this->userId('Bob')]));
        $this->ok($gm->put($path . $dwarf['id'], ['user_id' => (string) $this->userId('Dan')]));
        if ($start) {
            $this->startSession($w);
        }

        return $w + ['big' => (string) $big['id'], 'bigFloor' => $floor, 'a' => $a, 'b' => $b, 'img' => $img, 'elf' => $elf, 'dwarf' => $dwarf];
    }

    // ---- Map content ------------------------------------------------------------------------

    /**
     * @param list<array{0: int|float, 1: int|float}> $points
     * @param array<string, mixed>                     $over
     * @return array<string, mixed>
     */
    protected static function wallObject(string $uid, string $floor, array $points, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'wall',
            'layer' => 'walls',
            'geometry' => ['points' => $points, 'closed' => false],
            'props' => [
                'kind' => 'stone', 'thickness' => 0.15, 'blocks_vision' => true, 'blocks_light' => true,
                'blocks_move' => true, 'texture_asset' => null, 'height' => null,
            ],
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function doorObject(string $uid, string $floor, array $a, array $b, bool $secret = false, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'door',
            'layer' => 'walls',
            'geometry' => ['a' => $a, 'b' => $b],
            'props' => ['state' => 'closed', 'locked' => false, 'secret' => $secret, 'asset_open' => null, 'asset_closed' => null, 'swing' => 'a'],
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function placedToken(string $uid, string $floor, string $tokenId, int|float $x, int|float $y, array $over = []): array
    {
        return array_replace([
            'uid' => $uid, 'floor' => $floor, 'token_id' => $tokenId, 'x' => $x, 'y' => $y,
            'rotation' => 0, 'scale' => 1, 'hidden' => false, 'light_override' => null,
        ], $over);
    }

    /**
     * @param list<array<string, mixed>> $objects
     * @param list<array<string, mixed>> $tokens
     */
    protected function fill(ApiClient $gm, string $mapId, array $objects, array $tokens = []): void
    {
        $ops = [];
        foreach ($objects as $o) {
            $ops[] = ['type' => 'object.add', 'object' => $o];
        }
        foreach ($tokens as $t) {
            $ops[] = ['type' => 'maptoken.add', 'token' => $t];
        }
        $data = self::data($this->ok($this->sendOps($gm, $mapId, $ops)));
        self::assertSame(count($ops), $data['applied'], json_encode($data));
    }

    /**
     * Fog block (cx, cy) of a floor explored, written straight to the database.
     */
    protected function explore(string $mapId, string $floorId, int $cx, int $cy): void
    {
        $raw = str_repeat("\xff", 2048);
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_fog') . ' (`map_id`, `floor_id`, `cx`, `cy`, `data`, `updated_at`) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
            [(int) $mapId, (int) $floorId, $cx, $cy, gzdeflate($raw, 6)],
        );
    }
}
