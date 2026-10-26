<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

use JDR\Maps\TokenRules;

/**
 * maptoken.add / maptoken.update / maptoken.remove (placed tokens, table map_tokens):
 * validation, token of the same game, conflicts, rev, rounding, limit.
 */
final class MapTokenOpsTest extends MapsP5TestCase
{
    public function testPlaceMoveAndRemove(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard, 'goblin' => $goblin] = $this->p5Scene();
        $light = ['radius' => 2, 'dim_radius' => 4.5, 'color' => '#FFCC00', 'intensity' => 0.75, 'flicker' => true];
        $r = $this->opsOk($gm, $map['id'], [
            self::addToken(self::placed('t1', $f, $guard['id'], ['x' => 5.12349, 'y' => 0, 'rev' => 9])),
            self::addToken(self::placed('t2', $f, $goblin['id'], ['x' => 60, 'y' => 40, 'rotation' => 359, 'scale' => 0.256, 'hidden' => true, 'light_override' => $light])),
        ]);
        self::assertSame(['revision' => 1, 'applied' => 2, 'conflicts' => []], $r);
        $tokens = $this->tokensOf($gm, $map['id']);
        self::assertSame([
            'uid' => 't1',
            'floor' => $f,
            'token_id' => $guard['id'],
            'x' => 5.123,
            'y' => 0,
            'rotation' => 0,
            'scale' => 1,
            'hidden' => false,
            'light_override' => null,
            'rev' => 1,
        ], $tokens['t1']);
        self::assertSame(0.26, $tokens['t2']['scale']);
        self::assertSame(['radius' => 2, 'dim_radius' => 4.5, 'color' => '#ffcc00', 'intensity' => 0.75, 'flicker' => true], $tokens['t2']['light_override']);

        $r = $this->opsOk($gm, $map['id'], [
            ['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['x' => 7.5, 'y' => 8.25, 'rotation' => 90]],
            ['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 2, 'patch' => ['hidden' => true, 'light_override' => $light]],
            ['type' => 'maptoken.update', 'uid' => 't2', 'rev' => 1, 'patch' => ['light_override' => null, 'scale' => 4]],
        ]);
        self::assertSame(3, $r['applied']);
        $tokens = $this->tokensOf($gm, $map['id']);
        self::assertSame([7.5, 8.25, 90, true, 3], [$tokens['t1']['x'], $tokens['t1']['y'], $tokens['t1']['rotation'], $tokens['t1']['hidden'], $tokens['t1']['rev']]);
        self::assertSame([null, 4, 2], [$tokens['t2']['light_override'], $tokens['t2']['scale'], $tokens['t2']['rev']]);

        $r = $this->opsOk($gm, $map['id'], [['type' => 'maptoken.remove', 'uid' => 't2'], ['type' => 'maptoken.remove', 'uid' => 't2']]);
        self::assertSame(1, $r['applied']);
        self::assertSame(['t1'], array_keys($this->tokensOf($gm, $map['id'])));
    }

    public function testConflicts(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard] = $this->p5Scene();
        $this->opsOk($gm, $map['id'], [self::addToken(self::placed('t1', $f, $guard['id']))]);
        $this->opsOk($gm, $map['id'], [['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['x' => 9]]]);
        $current = $this->tokensOf($gm, $map['id'])['t1'];
        $r = $this->opsOk($gm, $map['id'], [
            self::addToken(self::placed('T1', $f, $guard['id'])),
            ['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['x' => 1]],
            ['type' => 'maptoken.update', 'uid' => 'zz', 'rev' => 1, 'patch' => ['x' => 1]],
            ['type' => 'maptoken.remove', 'uid' => 'zz'],
        ]);
        self::assertSame(['revision' => 2, 'applied' => 0], array_slice($r, 0, 2));
        self::assertSame([
            ['op_index' => 0, 'kind' => 'maptoken', 'uid' => 'T1', 'reason' => 'exists', 'current' => $current],
            ['op_index' => 1, 'kind' => 'maptoken', 'uid' => 't1', 'reason' => 'stale', 'current' => $current],
            ['op_index' => 2, 'kind' => 'maptoken', 'uid' => 'zz', 'reason' => 'gone', 'current' => null],
        ], $r['conflicts']);
        // Objects and placed tokens are separate namespaces.
        $this->opsOk($gm, $map['id'], [self::addObject(self::wall('t1', $f))]);
    }

    public function testValidation(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard, 'game' => $game] = $this->p5Scene();
        $this->opsOk($gm, $map['id'], [self::addToken(self::placed('t1', $f, $guard['id']))]);
        $other = $this->newGame($gm, 'Autre');
        $foreign = $this->newToken($gm, $other['id'], ['name' => 'Étranger']);
        $deleted = $this->newToken($gm, $game['id'], ['name' => 'Supprimé']);
        self::assertSame(204, $gm->delete('/tokens/' . $deleted['id'])->status());
        $add = static fn (array $over): array => self::addToken(self::placed('n1', $f, $guard['id'], $over));
        $light = ['radius' => 2, 'dim_radius' => 4, 'color' => '#ffcc00', 'intensity' => 0.5, 'flicker' => false];
        $cases = [
            [['type' => 'maptoken.add'], ['ops.0.token' => 'required']],
            [['type' => 'maptoken.add', 'token' => 'x'], ['ops.0.token' => 'invalid']],
            [$add(['extra' => 1]), ['ops.0.token' => 'invalid']],
            [$add(['uid' => 'é']), ['ops.0.token.uid' => 'invalid']],
            [$add(['floor' => null]), ['ops.0.token.floor' => 'invalid']],
            [$add(['floor' => '999999']), ['ops.0.token.floor' => 'not_found']],
            [$add(['token_id' => 'abc']), ['ops.0.token.token_id' => 'invalid']],
            [$add(['token_id' => $foreign['id']]), ['ops.0.token.token_id' => 'not_found']],
            [$add(['token_id' => $deleted['id']]), ['ops.0.token.token_id' => 'not_found']],
            [$add(['token_id' => '999999']), ['ops.0.token.token_id' => 'not_found']],
            [$add(['x' => 60.5]), ['ops.0.token.x' => 'too_large']],
            [$add(['y' => -1]), ['ops.0.token.y' => 'too_small']],
            [$add(['y' => '1']), ['ops.0.token.y' => 'invalid']],
            [$add(['rotation' => 360]), ['ops.0.token.rotation' => 'too_large']],
            [$add(['rotation' => 1.5]), ['ops.0.token.rotation' => 'invalid']],
            [$add(['scale' => 0.2]), ['ops.0.token.scale' => 'too_small']],
            [$add(['scale' => 4.5]), ['ops.0.token.scale' => 'too_large']],
            [$add(['hidden' => 0]), ['ops.0.token.hidden' => 'invalid']],
            [$add(['light_override' => true]), ['ops.0.token.light_override' => 'invalid']],
            [$add(['light_override' => ['radius' => 1]]), ['ops.0.token.light_override.color' => 'required']],
            [$add(['light_override' => ['radius' => 5] + $light]), ['ops.0.token.light_override.dim_radius' => 'below_radius']],
            [$add(['light_override' => ['color' => 'red'] + $light]), ['ops.0.token.light_override.color' => 'invalid']],
            [$add(['light_override' => ['intensity' => 2] + $light]), ['ops.0.token.light_override.intensity' => 'too_large']],
            [$add(['light_override' => ['cone' => null] + $light]), ['ops.0.token.light_override' => 'invalid']],
            [self::addToken(array_diff_key(self::placed('n1', $f, $guard['id']), ['hidden' => 1])), ['ops.0.token.hidden' => 'required']],
            [['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => []], ['ops.0.patch' => 'invalid']],
            [['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['token_id' => $guard['id']]], ['ops.0.patch' => 'invalid']],
            [['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['floor' => $f]], ['ops.0.patch' => 'invalid']],
            [['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['x' => 61]], ['ops.0.patch.x' => 'too_large']],
            [['type' => 'maptoken.update', 'uid' => 't1', 'rev' => 1, 'patch' => ['scale' => 'big']], ['ops.0.patch.scale' => 'invalid']],
            [['type' => 'maptoken.update', 'uid' => 't1', 'patch' => ['x' => 1]], ['ops.0.rev' => 'required']],
            [['type' => 'maptoken.remove'], ['ops.0.uid' => 'required']],
        ];
        $rev = $this->revision($map['id']);
        foreach ($cases as $i => [$op, $errors]) {
            $response = $this->sendOps($gm, $map['id'], [$op]);
            self::assertSame(422, $response->status(), 'case ' . $i . ': ' . $response->body());
            self::assertFieldErrors($response, $errors);
            self::assertSame($rev, $this->revision($map['id']), 'case ' . $i);
        }
    }

    public function testTokenLimitPerMap(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard] = $this->p5Scene();
        $rows = [];
        $now = gmdate('Y-m-d H:i:s');
        for ($i = 0; $i < TokenRules::MAX_TOKENS; $i++) {
            $rows[] = "('x" . $i . "', " . (int) $map['id'] . ', ' . (int) $f . ', ' . (int) $guard['id'] . ", 1, 1, '" . $now . "')";
        }
        $this->db->execute('INSERT INTO ' . $this->db->t('map_tokens') . ' (`uid`, `map_id`, `floor_id`, `token_id`, `x`, `y`, `updated_at`) VALUES ' . implode(', ', $rows));
        $this->opsFail($gm, $map['id'], [self::addToken(self::placed('over', $f, $guard['id']))], ['ops.0' => 'too_many']);
        $this->opsOk($gm, $map['id'], [['type' => 'maptoken.remove', 'uid' => 'x5'], self::addToken(self::placed('over', $f, $guard['id']))]);
        self::assertSame(TokenRules::MAX_TOKENS, $this->rows('map_tokens', '`map_id` = ?', [(int) $map['id']]));
    }
}
