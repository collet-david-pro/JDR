<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\MapsP4c\MapsP4cTestCase;

/**
 * API tests of the P5 map content (etapes/P05 "Contrat d'API P5"): objects, placed tokens, fog.
 */
abstract class MapsP5TestCase extends MapsP4cTestCase
{
    /**
     * GM, game, map 60 x 40 and two token definitions (Garde, Gobelin).
     *
     * @return array{gm: ApiClient, game: array<string, mixed>, map: array<string, mixed>, floor: string,
     *     guard: array<string, mixed>, goblin: array<string, mixed>}
     */
    protected function p5Scene(array $mapBody = []): array
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id'], $mapBody);
        $guard = $this->newToken($gm, $game['id'], ['name' => 'Garde', 'kind' => 'npc']);
        $goblin = $this->newToken($gm, $game['id'], ['name' => 'Gobelin', 'kind' => 'monster']);

        return ['gm' => $gm, 'game' => $game, 'map' => $map, 'floor' => $map['floors'][0]['id'], 'guard' => $guard, 'goblin' => $goblin];
    }

    /**
     * @param list<array{0: int|float, 1: int|float}> $points
     * @param array<string, mixed>                     $over
     * @return array<string, mixed>
     */
    protected static function wall(string $uid, string $floor, array $points = [[2, 2], [10, 2]], array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'wall',
            'layer' => 'walls',
            'geometry' => ['points' => $points, 'closed' => false],
            'props' => self::wallProps(),
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @return array<string, mixed>
     */
    protected static function wallProps(array $over = []): array
    {
        return array_replace([
            'kind' => 'stone',
            'thickness' => 0.15,
            'blocks_vision' => true,
            'blocks_light' => true,
            'blocks_move' => true,
            'texture_asset' => null,
            'height' => null,
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function door(string $uid, string $floor, array $a = [5, 2], array $b = [6, 2], array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'door',
            'layer' => 'walls',
            'geometry' => ['a' => $a, 'b' => $b],
            'props' => self::doorProps(),
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @return array<string, mixed>
     */
    protected static function doorProps(array $over = []): array
    {
        return array_replace([
            'state' => 'closed',
            'locked' => false,
            'secret' => false,
            'asset_open' => null,
            'asset_closed' => null,
            'swing' => 'a',
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function window(string $uid, string $floor, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'window',
            'layer' => 'walls',
            'geometry' => ['a' => [2, 4], 'b' => [2, 6]],
            'props' => ['kind' => 'glass'],
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function light(string $uid, string $floor, int|float $x = 10, int|float $y = 10, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'light',
            'layer' => 'lighting',
            'geometry' => ['x' => $x, 'y' => $y],
            'props' => self::lightProps(),
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @return array<string, mixed>
     */
    protected static function lightProps(array $over = []): array
    {
        return array_replace([
            'radius' => 4,
            'dim_radius' => 8,
            'color' => '#ffaa33',
            'intensity' => 0.8,
            'flicker' => ['type' => 'torch', 'amp' => 0.2, 'speed' => 2],
            'cone' => null,
            'enabled' => true,
            'follows_token' => null,
        ], $over);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function placed(string $uid, string $floor, string $tokenId, array $over = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'token_id' => $tokenId,
            'x' => 5,
            'y' => 5,
            'rotation' => 0,
            'scale' => 1,
            'hidden' => false,
            'light_override' => null,
        ], $over);
    }

    /**
     * @return array<string, mixed>
     */
    protected static function addObject(array $object): array
    {
        return ['type' => 'object.add', 'object' => $object];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function updateObject(string $uid, int $rev, array $patch): array
    {
        return ['type' => 'object.update', 'uid' => $uid, 'rev' => $rev, 'patch' => $patch];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function addToken(array $token): array
    {
        return ['type' => 'maptoken.add', 'token' => $token];
    }

    /**
     * Raw fog bitmap with the given sub-cells set.
     *
     * @param list<array{0: int, 1: int}> $subcells [sx, sy] in 0-127
     */
    protected static function fogBits(array $subcells): string
    {
        $raw = str_repeat("\0", 2048);
        foreach ($subcells as [$sx, $sy]) {
            $i = $sy * 128 + $sx;
            $raw[$i >> 3] = chr(ord($raw[$i >> 3]) | (0x80 >> ($i & 7)));
        }

        return $raw;
    }

    protected static function fogWire(string $raw): string
    {
        return base64_encode((string) gzdeflate($raw, 6));
    }

    /**
     * @param list<array{0: int, 1: int, 2: string}> $chunks [cx, cy, raw bitmap]
     * @return array<string, mixed>
     */
    protected static function fogOp(string $type, string $floor, array $chunks): array
    {
        return [
            'type' => $type,
            'floor' => $floor,
            'chunks' => array_map(static fn (array $c): array => [$c[0], $c[1], self::fogWire($c[2])], $chunks),
        ];
    }

    /**
     * GET /maps/{id}/fog?floor= decoded: "cx:cy" => raw bitmap.
     *
     * @return array<string, string>
     */
    protected function fogOf(ApiClient $client, string $mapId, string $floor): array
    {
        $response = $client->get('/maps/' . $mapId . '/fog?floor=' . $floor);
        self::assertSame(200, $response->status(), $response->body());
        $data = self::data($response);
        self::assertSame($floor, $data['floor']);
        $out = [];
        foreach ($data['chunks'] as [$cx, $cy, $b64]) {
            self::assertIsInt($cx);
            self::assertIsInt($cy);
            $raw = gzinflate((string) base64_decode($b64, true), 2048);
            self::assertIsString($raw);
            self::assertSame(2048, strlen($raw));
            $out[$cx . ':' . $cy] = $raw;
        }

        return $out;
    }

    /**
     * GET /maps/{id} objects keyed by uid.
     *
     * @return array<string, array<string, mixed>>
     */
    protected function objectsOf(ApiClient $client, string $mapId): array
    {
        $out = [];
        foreach (self::data($client->get('/maps/' . $mapId))['objects'] as $object) {
            $out[$object['uid']] = $object;
        }

        return $out;
    }

    /**
     * GET /maps/{id} placed tokens keyed by uid.
     *
     * @return array<string, array<string, mixed>>
     */
    protected function tokensOf(ApiClient $client, string $mapId): array
    {
        $out = [];
        foreach (self::data($client->get('/maps/' . $mapId))['tokens_placed'] as $token) {
            $out[$token['uid']] = $token;
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $ops
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
     * Logged-in client of an existing user (member added by addMember).
     */
    protected function login(string $username): ApiClient
    {
        static $ip = 150;
        $client = $this->client('198.51.100.' . (++$ip % 250));
        $client->login($username, self::PASSWORD);

        return $client;
    }

    protected function sceneRepository(): \JDR\Domain\Maps\MapSceneRepository
    {
        return $this->app()->container()->get(\JDR\Domain\Maps\MapSceneRepository::class);
    }
}
