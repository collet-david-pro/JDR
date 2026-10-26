<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;

/**
 * Rights on the P5 routes and ops (projet.md 11.2, P3 criterion): GM and co-GM only; a player
 * member gets 403, anyone else 404 (existence never revealed), anonymous 401; a map in the trash
 * is 404. Nothing is written by a refused request.
 */
final class MapSceneRightsTest extends MapsP5TestCase
{
    public function testEveryP5RouteIsForEditorsOnly(): void
    {
        ['gm' => $gm, 'game' => $game, 'map' => $map, 'floor' => $f, 'guard' => $guard] = $this->p5Scene();
        $this->addMember($gm, $game['id'], 'Bob');
        $bob = $this->login('Bob');
        $this->addMember($gm, $game['id'], 'Carol', 'co_gm');
        $carol = $this->login('Carol');
        $dave = $this->user('Dave');
        $anonymous = $this->client('198.51.100.249');
        $this->opsOk($gm, $map['id'], [self::addObject(self::wall('w1', $f)), self::fogOp('fog.reveal', $f, [[0, 0, self::fogBits([[1, 1]])]])]);

        $base = '/maps/' . $map['id'];
        $n = 0;
        $requests = [
            'fog' => static fn (ApiClient $c): Response => $c->get($base . '/fog?floor=' . $f),
            'objects' => static fn (ApiClient $c): Response => $c->get($base . '/objects?floor=' . $f . '&bbox=0,0,10,10'),
            'ops' => function (ApiClient $c) use ($base, $f, $guard, &$n): Response {
                $n++;

                return $c->post($base . '/ops', [
                    'base_revision' => 0,
                    'client_op_id' => 'rights-' . $n,
                    'ops' => [
                        self::addObject(self::light('l' . $n, $f)),
                        self::updateObject('w1', 99, ['locked' => true]),
                        self::addToken(self::placed('t' . $n, $f, $guard['id'])),
                        self::fogOp('fog.reveal', $f, [[1, 0, self::fogBits([[2, 2]])]]),
                    ],
                ]);
            },
            'clear fog' => static fn (ApiClient $c): Response => $c->delete($base . '/fog?floor=' . $f),
        ];
        foreach ($requests as $label => $send) {
            $before = $this->snapshot((int) $map['id']);
            self::assertSame(401, $send($anonymous)->status(), $label . ' anonymous');
            self::assertSame(404, $send($dave)->status(), $label . ' stranger');
            $response = $send($bob);
            self::assertSame(403, $response->status(), $label . ' player');
            self::assertSame('forbidden', self::errorCode($response));
            self::assertSame($before, $this->snapshot((int) $map['id']), $label . ': nothing written');
            self::assertSame(200, $send($carol)->status(), $label . ' co-GM');
            self::assertSame(200, $send($gm)->status(), $label . ' GM');
        }
        // Even the parameter checks come after the rights.
        self::assertSame(404, $dave->get($base . '/fog')->status());
        self::assertSame(403, $bob->get($base . '/objects?bbox=x')->status());

        // A map in the trash: 404 for everyone.
        self::assertSame(204, $gm->delete($base)->status());
        foreach ($requests as $label => $send) {
            self::assertSame(404, $send($gm)->status(), $label . ' in the trash');
        }
        // A map of another game: 404 even for a GM of this game.
        $other = $this->newGame($dave, 'Autre');
        $foreign = $this->newMap($dave, $other['id']);
        self::assertSame(404, $gm->get('/maps/' . $foreign['id'] . '/fog?floor=' . $foreign['floors'][0]['id'])->status());
        self::assertSame(404, $gm->delete('/maps/' . $foreign['id'] . '/fog?floor=' . $foreign['floors'][0]['id'])->status());
        // A token of the GM's game cannot be placed on the map of another game.
        $this->opsFail($dave, $foreign['id'], [self::addToken(self::placed('x', $foreign['floors'][0]['id'], $guard['id']))], ['ops.0.token.token_id' => 'not_found']);
    }

    /**
     * @return array<string, int>
     */
    private function snapshot(int $mapId): array
    {
        $out = ['revision' => (int) $this->db->fetchValue('SELECT `revision` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$mapId])];
        foreach (['map_objects', 'map_tokens', 'map_fog'] as $table) {
            $out[$table] = $this->rows($table, '`map_id` = ?', [$mapId]);
        }
        $out['rev'] = (int) $this->db->fetchValue('SELECT COALESCE(SUM(`rev`), 0) FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ?', [$mapId]);

        return $out;
    }
}
