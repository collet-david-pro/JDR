<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;

/**
 * Helpers of the P9a1 tests: floors with uids, stairs, portals, links.
 */
trait P9Helpers
{
    /**
     * @return array<string, mixed>
     */
    protected static function floorAdd(string $uid, string $name, int $level): array
    {
        return ['type' => 'floor.add', 'floor' => ['uid' => $uid, 'name' => $name, 'level' => $level]];
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function stairs(string $uid, string $floor, string $toFloor, array $over = [], array $props = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'stairs',
            'layer' => 'props',
            'geometry' => ['x' => 4, 'y' => 4, 'w' => 2, 'h' => 1],
            'props' => array_replace(['direction' => 'up', 'to_floor' => $toFloor], $props),
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * @param array<string, mixed> $link
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function portal(string $uid, string $floor, array $link, array $over = [], array $props = []): array
    {
        return array_replace([
            'uid' => $uid,
            'floor' => $floor,
            'type' => 'portal',
            'layer' => 'props',
            'geometry' => ['x' => 7.5, 'y' => 3],
            'props' => array_replace(['icon' => 'portal', 'color' => '#8844ff', 'link' => $link], $props),
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $over);
    }

    /**
     * Floors of the map as the API returns them.
     *
     * @return list<array<string, mixed>>
     */
    protected function floorsOf(ApiClient $gm, string $mapId): array
    {
        return self::data($this->ok($gm->get('/maps/' . $mapId)))['floors'];
    }

    /**
     * Id (string) of the floor with that uid.
     */
    protected function floorId(string $mapId, string $uid): string
    {
        return (string) $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('map_floors') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $mapId, $uid]);
    }

    /**
     * A game with a GM and two maps ("A" 60 x 40, "B" 60 x 40).
     *
     * @return array{gm: ApiClient, game: string, a: array<string, mixed>, b: array<string, mixed>, fa: string, fb: string}
     */
    protected function twoMaps(): array
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $a = $this->newMap($gm, $game, ['name' => 'Donjon']);
        $b = $this->newMap($gm, $game, ['name' => 'Village']);

        return ['gm' => $gm, 'game' => $game, 'a' => $a, 'b' => $b, 'fa' => (string) $a['floors'][0]['id'], 'fb' => (string) $b['floors'][0]['id']];
    }

    // Copies of the helpers of MapsP5TestCase / SessionsTestCase, so that the two bases can use the trait.

    protected static function addObject(array $object): array
    {
        return ['type' => 'object.add', 'object' => $object];
    }

    protected static function updateObject(string $uid, int $rev, array $patch): array
    {
        return ['type' => 'object.update', 'uid' => $uid, 'rev' => $rev, 'patch' => $patch];
    }

    protected static function addToken(array $token): array
    {
        return ['type' => 'maptoken.add', 'token' => $token];
    }

    /**
     * fog.reveal of block 0:0, entirely.
     */
    protected static function fogReveal(string $floor): array
    {
        return ['type' => 'fog.reveal', 'floor' => $floor, 'chunks' => [[0, 0, self::b64(str_repeat("\xff", 2048))]]];
    }

    protected function opsFail(ApiClient $client, string $mapId, array $ops, array $errors): Response
    {
        $before = $this->revision($mapId);
        $response = $this->sendOps($client, $mapId, $ops);
        self::assertFieldErrors($response, $errors);
        self::assertSame($before, $this->revision($mapId), 'a refused lot changes nothing');

        return $response;
    }

    protected function ok(Response $response, int $status = 200): Response
    {
        self::assertSame($status, $response->status(), $response->body());

        return $response;
    }

    protected function login(string $username): ApiClient
    {
        static $ip = 40;
        $client = $this->client('198.51.100.' . (++$ip % 250));
        $client->login($username, self::PASSWORD);

        return $client;
    }

    protected static function b64(string $raw): string
    {
        return base64_encode((string) gzdeflate($raw, 6));
    }
}
