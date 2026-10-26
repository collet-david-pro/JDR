<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

use JDR\Core\Router;

/**
 * Acceptance criterion P3 (projet.md 23, 11.2): on EVERY route of the application that takes the
 * id of a game, token, encounter or map (P4b, P4c: versions, export, import, thumbnail) (list generated from the router), an anonymous visitor gets
 * 401, a third-party account (admins included) gets 404 and no data, a player member gets 403 on
 * every GM write.
 */
final class GameRightsMatrixTest extends GamesTestCase
{
    /**
     * Every route whose path holds the id of a game, token, encounter or map.
     *
     * @return list<array{method: string, pattern: string}>
     */
    private static function gameRoutes(): array
    {
        $router = new Router();
        (require dirname(__DIR__, 3) . '/app/Http/routes.php')($router);
        $routes = (new \ReflectionProperty(Router::class, 'routes'))->getValue($router);
        $out = [];
        foreach ($routes as $route) {
            if (preg_match('#^/(games|tokens|encounters|maps)/\{id#', $route['pattern']) !== 1) {
                continue;
            }
            foreach ($route['methods'] as $method) {
                $out[] = ['method' => $method, 'pattern' => $route['pattern']];
            }
        }

        return $out;
    }

    /**
     * @param array{game: string, token: string, encounter: string, member: string, map: string, version: string} $ids
     */
    private static function path(string $pattern, array $ids): string
    {
        $kind = explode('/', $pattern)[1];
        $id = match ($kind) {
            'games' => $ids['game'],
            'tokens' => $ids['token'],
            'maps' => $ids['map'],
            default => $ids['encounter'],
        };
        $path = (string) preg_replace('/\{id(?::[^}]+)?\}/', $id, $pattern);

        $path = (string) preg_replace('/\{vid(?::[^}]+)?\}/', $ids['version'], $path);

        return (string) preg_replace('/\{userId(?::[^}]+)?\}/', $ids['member'], $path);
    }

    /**
     * Expected status of a player member (GM writes 403; reads allowed except the GM ones).
     */
    private static function playerStatus(string $method, string $pattern): int
    {
        if ($method !== 'GET') {
            return 403;
        }

        return match ($pattern) {
            '/games/{id:\d+}', '/games/{id:\d+}/members', '/games/{id:\d+}/tokens', '/games/{id:\d+}/sessions' => 200, // sessions: his own only (P6b)
            default => 403, // GET /tokens/{id} (not the owner), GET /games/{id}/encounters
        };
    }

    public function testEveryGameRouteIsClosedToStrangersAndGmWritesToPlayers(): void
    {
        $routes = self::gameRoutes();
        self::assertGreaterThanOrEqual(34, count($routes));

        $gm = $this->user('Alice');
        $game = $this->newGame($gm, 'Secret des Abysses', ['description' => 'Notes cachées']);
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'token']);
        $this->addMember($gm, $game['id'], 'Bob');
        $coGm = $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $token = $this->newToken($gm, $game['id'], ['name' => 'Liche ancienne', 'asset_id' => $asset['id']]);
        $encounter = self::data($gm->post('/games/' . $game['id'] . '/encounters', [
            'name' => 'Embuscade',
            'tokens' => [['token_id' => $token['id'], 'dx' => 1, 'dy' => 0]],
        ]));
        $map = self::data($gm->post('/games/' . $game['id'] . '/maps', ['name' => 'Crypte interdite', 'width' => 40, 'height' => 40]));
        $floor = $map['floors'][0]['id'];
        self::assertSame(200, $gm->post('/maps/' . $map['id'] . '/ops', ['base_revision' => 0, 'client_op_id' => 'matrix-1', 'ops' => [
            ['type' => 'palette.add', 'index' => 1, 'asset_id' => $asset['id']],
            ['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground', 'cells' => [[1, 1, 1, 0, 0]]],
        ]])->status());
        $version = self::data($gm->post('/maps/' . $map['id'] . '/versions', ['label' => 'Avant le piège']));
        $ids = [
            'game' => $game['id'], 'token' => $token['id'], 'encounter' => $encounter['id'], 'member' => $coGm['user']['id'],
            'map' => $map['id'], 'version' => $version['id'],
        ];
        $secrets = ['Secret des Abysses', 'Notes cachées', 'Liche ancienne', 'Embuscade', $asset['uuid'], 'Crypte interdite', 'Avant le piège',
            (string) $this->db->fetchValue('SELECT `sha256` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $asset['id']])];

        $anonymous = $this->client('198.51.100.200');
        $anonymous->me();
        $player = $this->client('198.51.100.201');
        $player->login('Bob', self::PASSWORD);
        $strangers = ['Dave' => $this->user('Dave'), 'Admin' => $this->user('Admin', 'admin')];

        foreach ($routes as ['method' => $method, 'pattern' => $pattern]) {
            $path = self::path($pattern, $ids);
            $body = $method === 'GET' ? null : [
                'name' => 'x', 'role' => 'player', 'identifier' => 'Dave', 'width' => 10, 'height' => 10,
                'base_revision' => 1, 'client_op_id' => 'matrix-' . $method . '-' . md5($path),
                'ops' => [['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground', 'cells' => [[1, 1, 0, 0, 0]]]],
            ];
            $label = $method . ' ' . $path;

            $r = $anonymous->request($method, $path, $body);
            self::assertSame(401, $r->status(), 'anonymous ' . $label);

            foreach ($strangers as $who => $stranger) {
                $r = $stranger->request($method, $path, $body);
                self::assertSame(404, $r->status(), $who . ' ' . $label . ' ' . $r->body());
                self::assertSame('not_found', self::errorCode($r));
                foreach ($secrets as $secret) {
                    self::assertStringNotContainsString($secret, $r->body(), $who . ' ' . $label);
                }
            }

            $r = $player->request($method, $path, $body);
            self::assertSame(self::playerStatus($method, $pattern), $r->status(), 'player ' . $label . ' ' . $r->body());
        }

        // Asset scope and asset of the game: nothing for strangers.
        foreach ($strangers as $who => $stranger) {
            self::assertSame(404, $stranger->get('/assets?scope=game:' . $game['id'])->status(), $who);
            self::assertSame(404, $stranger->get('/assets/' . $asset['id'])->status(), $who);
            foreach (['/games', '/games?state=archived', '/games?state=trash', '/games?role=player'] as $list) {
                self::assertSame([], self::data($stranger->get($list)), $who . ' ' . $list);
            }
        }

        // Nothing was changed by the refused requests.
        $after = self::data($gm->get('/games/' . $game['id']));
        self::assertSame('Secret des Abysses', $after['name']);
        self::assertNull($after['deleted_at']);
        self::assertNull($after['archived_at']);
        self::assertSame(3, $after['counts']['members']);
        self::assertSame('Liche ancienne', self::data($gm->get('/tokens/' . $token['id']))['name']);
        self::assertSame('Embuscade', self::data($gm->get('/games/' . $game['id'] . '/encounters'))[0]['name']);
        self::assertSame(['gm', 'player', 'co_gm'], array_column(self::data($gm->get('/games/' . $game['id'] . '/members')), 'role'));
        $mapAfter = self::data($gm->get('/maps/' . $map['id']));
        self::assertSame('Crypte interdite', $mapAfter['name']);
        self::assertSame(1, $mapAfter['revision']);
        self::assertSame(['Crypte interdite'], array_column(self::data($gm->get('/games/' . $game['id'] . '/maps')), 'name'));
        self::assertSame(1, $this->rows('map_chunks'));
        self::assertSame(1, $this->rows('maps'));
        self::assertSame(['manual'], array_column(self::data($gm->get('/maps/' . $map['id'] . '/versions')), 'kind'));
        self::assertNull($mapAfter['thumb_url']);
    }

    public function testUnknownIdsAre404ForEveryone(): void
    {
        $gm = $this->user('Alice');
        $ids = ['game' => '999999', 'token' => '999999', 'encounter' => '999999', 'member' => '999999', 'map' => '999999', 'version' => '999999'];
        foreach (self::gameRoutes() as ['method' => $method, 'pattern' => $pattern]) {
            $r = $gm->request($method, self::path($pattern, $ids), $method === 'GET' ? null : []);
            self::assertSame(404, $r->status(), $method . ' ' . $pattern);
        }
    }

    public function testCoGmEditsButDoesNotManage(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $bob = $this->addMember($gm, $game['id'], 'Bob');
        $coGm = $this->client('198.51.100.150');
        $coGm->login('Carol', self::PASSWORD);

        $token = $this->newToken($coGm, $game['id']);
        self::assertSame(200, $coGm->patch('/tokens/' . $token['id'], ['name' => 'Orque'])->status());
        self::assertSame(201, $coGm->post('/games/' . $game['id'] . '/encounters', ['name' => 'E'])->status());
        self::assertSame('co_gm', self::data($coGm->get('/games/' . $game['id']))['my_role']);

        foreach ([
            ['PATCH', '/games/' . $game['id'], ['name' => 'x']],
            ['DELETE', '/games/' . $game['id'], null],
            ['POST', '/games/' . $game['id'] . '/archive', []],
            ['POST', '/games/' . $game['id'] . '/restore', []],
            ['POST', '/games/' . $game['id'] . '/members', ['identifier' => 'Dave']],
            ['PATCH', '/games/' . $game['id'] . '/members/' . $bob['user']['id'], ['role' => 'co_gm']],
            ['DELETE', '/games/' . $game['id'] . '/members/' . $bob['user']['id'], null],
        ] as [$method, $path, $body]) {
            self::assertSame(403, $coGm->request($method, $path, $body)->status(), $method . ' ' . $path);
        }
        self::assertSame(204, $coGm->delete('/tokens/' . $token['id'])->status());
    }
}
