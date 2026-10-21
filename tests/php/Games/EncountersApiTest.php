<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

/**
 * Prepared encounters: create, validation, update, delete, place (P4).
 */
final class EncountersApiTest extends GamesTestCase
{
    public function testCrud(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $a = $this->newToken($alice, $game['id'], ['name' => 'A']);
        $b = $this->newToken($alice, $game['id'], ['name' => 'B']);
        $path = '/games/' . $game['id'] . '/encounters';

        $created = $alice->post($path, [
            'name' => 'Embuscade',
            'notes' => "  Au pont\n  ",
            'tokens' => [['token_id' => $a['id'], 'dx' => -1.25, 'dy' => 2], ['token_id' => (int) $b['id'], 'dx' => 0, 'dy' => 0]],
        ]);
        self::assertSame(201, $created->status(), $created->body());
        $encounter = self::data($created);
        self::assertSame($game['id'], $encounter['game_id']);
        self::assertSame('Embuscade', $encounter['name']);
        self::assertSame('Au pont', $encounter['notes']);
        self::assertSame([
            ['token_id' => $a['id'], 'dx' => -1.25, 'dy' => 2],
            ['token_id' => $b['id'], 'dx' => 0, 'dy' => 0],
        ], $encounter['tokens']);

        $empty = self::data($alice->post($path, ['name' => 'Vide']));
        self::assertNull($empty['notes']);
        self::assertSame([], $empty['tokens']);
        self::assertSame(['Embuscade', 'Vide'], array_column(self::data($alice->get($path)), 'name'));

        $patched = self::data($alice->patch('/encounters/' . $encounter['id'], [
            'name' => 'Embuscade 2',
            'notes' => null,
            'tokens' => [['token_id' => $b['id'], 'dx' => 3, 'dy' => -3]],
        ]));
        self::assertSame('Embuscade 2', $patched['name']);
        self::assertNull($patched['notes']);
        self::assertSame([['token_id' => $b['id'], 'dx' => 3, 'dy' => -3]], $patched['tokens']);
        $renamed = self::data($alice->patch('/encounters/' . $encounter['id'], ['name' => 'E3']));
        self::assertSame($patched['tokens'], $renamed['tokens']);

        // place: P4 (no maps yet) => 404 even for the GM.
        $place = $alice->post('/encounters/' . $encounter['id'] . '/place', ['map_id' => '1', 'floor_id' => '1', 'x' => 0, 'y' => 0]);
        self::assertSame(404, $place->status());
        self::assertSame('not_found', self::errorCode($place));

        self::assertSame(204, $alice->delete('/encounters/' . $encounter['id'])->status());
        self::assertSame(404, $alice->patch('/encounters/' . $encounter['id'], ['name' => 'x'])->status());
        self::assertSame(1, $this->rows('encounters'));
        self::assertSame(0, $this->rows('encounter_tokens'));
    }

    public function testValidation(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $other = $this->newGame($alice, 'Autre partie');
        $token = $this->newToken($alice, $game['id']);
        $foreign = $this->newToken($alice, $other['id']);
        $deleted = $this->newToken($alice, $game['id'], ['name' => 'Mort']);
        $alice->delete('/tokens/' . $deleted['id']);
        $path = '/games/' . $game['id'] . '/encounters';
        $entry = static fn (string $id, mixed $dx = 0, mixed $dy = 0): array => ['token_id' => $id, 'dx' => $dx, 'dy' => $dy];

        self::assertFieldErrors($alice->post($path, []), ['name' => 'required']);
        self::assertFieldErrors($alice->post($path, ['name' => str_repeat('e', 121), 'notes' => str_repeat('n', 10001)]), [
            'name' => 'too_long',
            'notes' => 'too_long',
        ]);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => 'abc']), ['tokens' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => [$entry($token['id']), $entry($token['id'], 1, 1)]]), ['tokens' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => [$entry($token['id'], 10000)]]), ['tokens' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => [$entry($token['id'], '1')]]), ['tokens' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => [['token_id' => $token['id'], 'dx' => 0, 'dy' => 0, 'hp' => 7]]]), ['tokens' => 'invalid']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => [$entry($foreign['id'])]]), ['tokens' => 'not_found']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => [$entry($deleted['id'])]]), ['tokens' => 'not_found']);
        self::assertFieldErrors($alice->post($path, ['name' => 'x', 'tokens' => array_fill(0, 101, $entry($token['id']))]), ['tokens' => 'too_large']);
        self::assertSame(0, $this->rows('encounters'));
        self::assertSame(201, $alice->post($path, ['name' => 'x', 'tokens' => [$entry($token['id'], -9999.999, 9999.999)]])->status());
    }
}
