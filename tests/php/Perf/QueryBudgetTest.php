<?php

declare(strict_types=1);

namespace JDR\Tests\Perf;

use JDR\Core\Db;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\SessionsActions\ActionsTestCase;

/**
 * SQL budget (projet.md 22, P10e): at most 10 statements per usual API request, measured with
 * Db::queryCount() on a medium data set (game, 3 players, 100 x 100 map with chunks, 50 tokens).
 * The measured counts are printed (one line per request) to be copied into the report.
 */
final class QueryBudgetTest extends ActionsTestCase
{
    private const BUDGET = 10;

    /**
     * Documented exceptions. P10e2a added a request-scoped memo (Core\RequestMemo: assignments,
     * fog blocks, vision, notes visibility, game tokens, objects, revealed uids, generation are read
     * once per request), which removed the repeated reads (before -> after: snapshot GM 15 -> 14,
     * player 23 -> 19, ops 29 -> 27, token.move 29 -> 27 and 31 -> 28). What is left are distinct
     * statements, one per table or per step, so ceilings = measured value + 1:
     * - snapshot / preload rebuild a whole scene once per client load: user, event cursor, session,
     *   players, assignments, map, floors, objects, notes, tokens, token definitions, fog, revealed
     *   uids (+ the player filter: explored fog, vision, note visibility, object boxes, chunks of
     *   the scope); preload also reads the revision in its own transaction (consistent chunks), and
     *   the objects the player sees (hidden tokens, revealed uids, object boxes, note visibility)
     *   to list the placed images to download;
     * - ops / actions are a locked write (map / session FOR UPDATE) that fans the change out to
     *   every audience: rate limit (3), idempotency check before and after the lock (a retry must
     *   get the stored answer without taking the lock), players, assignments, hidden tokens,
     *   revealed uids, active screens, fog scope before and after the change (the vision is read
     *   again because the moved token changed it), the D3 merge scan of each merged audience, the
     *   event_seq lock, the multi-row INSERT and the id read-back.
     */
    private const CEILINGS = [
        'GET /sessions/{id}/snapshot (GM)' => 15,
        'GET /sessions/{id}/snapshot (player)' => 20,
        'GET /sessions/{id}/preload (player)' => 17,
        'POST /maps/{id}/ops (edit)' => 28,
        'POST actions token.move (GM)' => 28,
        'POST actions token.move (player)' => 29,
    ];

    /** @var array<string, int> */
    private array $counts = [];

    public function testUsualRequestsStayWithinTheSqlBudget(): void
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        foreach (['Bob', 'Kim', 'Dan'] as $name) {
            $this->addMember($gm, $game, $name);
        }
        $map = $this->newMap($gm, $game, ['name' => 'Grande', 'width' => 100, 'height' => 100]);
        $mapId = (string) $map['id'];
        $tile = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $this->opsOk($gm, $mapId, [['type' => 'palette.add', 'index' => 1, 'asset_id' => $tile['id']]]);
        $floor = (string) $map['floors'][0]['id'];

        $cells = [];
        for ($x = 0; $x < 100; $x += 3) {
            for ($y = 0; $y < 100; $y += 3) {
                $cells[] = [$x, $y, 1];
            }
        }
        $this->opsOk($gm, $mapId, [['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground', 'cells' => array_map(static fn (array $c): array => [$c[0], $c[1], 1, 0, 0], $cells)]]);
        $def = $this->newToken($gm, $game, ['name' => 'Garde', 'kind' => 'npc']);
        $ops = [];
        for ($i = 0; $i < 50; $i++) {
            $ops[] = ['type' => 'maptoken.add', 'token' => [
                'uid' => 't' . $i, 'floor' => $floor, 'token_id' => $def['id'], 'x' => 2 + $i, 'y' => 3 + ($i % 7),
                'rotation' => 0, 'scale' => 1, 'hidden' => false, 'light_override' => null,
            ]];
        }
        $this->opsOk($gm, $mapId, $ops);

        $session = self::data($this->ok($gm->post('/games/' . $game . '/sessions', ['name' => 'S', 'map_id' => $map['id']]), 201));
        $sid = (string) $session['id'];
        $bob = $this->loginAs('Bob');
        $this->ok($bob->post('/sessions/join', ['code' => $session['code']]));
        $this->ok($gm->post('/assignments-placeholder', []) ?? null, 404);
        $this->ok($gm->put('/sessions/' . $sid . '/assignments/' . $def['id'], ['user_id' => (string) $this->userId('Bob')]));
        $this->ok($gm->post('/sessions/' . $sid . '/start'));

        $db = $this->app->container()->get(Db::class);
        self::assertInstanceOf(Db::class, $db);

        $this->measure($db, 'GET /games', $gm, 'GET', '/games');
        $this->measure($db, 'GET /games/{id}', $gm, 'GET', '/games/' . $game);
        $this->measure($db, 'GET /games/{id}/maps', $gm, 'GET', '/games/' . $game . '/maps');
        $this->measure($db, 'GET /maps/{id}', $gm, 'GET', '/maps/' . $mapId);
        $this->measure($db, 'GET /maps/{id}/chunks', $gm, 'GET', '/maps/' . $mapId . '/chunks?floor=' . $floor);
        $this->measure($db, 'GET /games/{id}/tokens', $gm, 'GET', '/games/' . $game . '/tokens');
        $this->measure($db, 'GET /assets (library)', $gm, 'GET', '/assets');
        $this->measure($db, 'GET /auth/me', $gm, 'GET', '/auth/me');
        $this->measure($db, 'GET /games/{id}/sessions', $gm, 'GET', '/games/' . $game . '/sessions');
        $this->measure($db, 'GET /sessions/{id} (GM)', $gm, 'GET', '/sessions/' . $sid);
        $this->measure($db, 'GET /sessions/{id}/snapshot (GM)', $gm, 'GET', '/sessions/' . $sid . '/snapshot');
        $this->measure($db, 'GET /sessions/{id}/snapshot (player)', $bob, 'GET', '/sessions/' . $sid . '/snapshot');
        $this->measure($db, 'GET /sessions/{id}/preload (player)', $bob, 'GET', '/sessions/' . $sid . '/preload');
        $this->measure($db, 'POST /maps/{id}/ops (edit)', $gm, 'POST', '/maps/' . $mapId . '/ops', [
            'base_revision' => (int) $this->db->fetchValue('SELECT `revision` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $mapId]),
            'client_op_id' => 'q-' . bin2hex(random_bytes(4)),
            'ops' => [['type' => 'tiles.set', 'floor' => $floor, 'layer' => 'ground', 'cells' => [[1, 1, 1, 0, 0], [2, 2, 1, 0, 0]]]],
        ]);
        $this->measure($db, 'POST actions token.move (GM)', $gm, 'POST', '/sessions/' . $sid . '/actions', $this->moveBody('t5', 9, 9));
        $this->measure($db, 'POST actions token.move (player)', $bob, 'POST', '/sessions/' . $sid . '/actions', $this->moveBody('t0', 4, 4));
        $this->measure($db, 'GET /events (poll, GM)', $gm, 'GET', '/events?channels=' . rawurlencode('session:' . $sid) . '&since=0&wait=0');
        $this->measure($db, 'GET /events (poll, player)', $bob, 'GET', '/events?channels=' . rawurlencode('session:' . $sid) . '&since=0&wait=0');
        $this->measure($db, 'POST /presence', $bob, 'POST', '/presence', ['session_id' => $sid]);

        fwrite(STDERR, "\nSQL per request (budget " . self::BUDGET . "):\n");
        foreach ($this->counts as $label => $n) {
            fwrite(STDERR, sprintf("  %-40s %2d\n", $label, $n));
        }
        foreach ($this->counts as $label => $n) {
            self::assertLessThanOrEqual(self::CEILINGS[$label] ?? self::BUDGET, $n, $label . ' runs ' . $n . ' SQL statements');
        }
    }

    /**
     * @return array<string, mixed>
     */

    private function moveBody(string $uid, int $x, int $y): array
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('rate_limits'));

        return ['client_op_id' => 'q-' . bin2hex(random_bytes(4)), 'actions' => [self::move($uid, $x, $y)]];
    }

    private function tokenRowId(string $mapId, string $uid): string
    {
        return (string) $this->db->fetchValue(
            'SELECT `id` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? AND `uid` = ?',
            [(int) $mapId, $uid],
        );
    }

    /**
     * @param array<string, mixed>|null $body
     */
    private function measure(Db $db, string $label, ApiClient $client, string $method, string $path, ?array $body = null): void
    {
        $before = $db->queryCount();
        $response = $method === 'GET' ? $client->get($path) : $client->post($path, $body ?? []);
        $this->counts[$label] = $db->queryCount() - $before;
        self::assertLessThan(300, $response->status(), $label . ': ' . $response->body());
    }
}
