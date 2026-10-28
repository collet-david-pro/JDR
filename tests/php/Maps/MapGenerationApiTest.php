<?php

declare(strict_types=1);

namespace JDR\Tests\Maps;

/**
 * P8e2a: POST /maps/{id}/versions {kind} and PATCH /maps/{id} {generation} (+ GET /maps/{id}).
 */
final class MapGenerationApiTest extends MapsTestCase
{
    private const GENERATION = ['generator' => 'dungeon', 'gen_version' => 1, 'seed' => 'abc12345', 'params' => ['preset' => 'crypt', 'rooms' => 8]];

    public function testVersionKindIsAcceptedDefaultedAndValidated(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        $url = '/maps/' . $map['id'] . '/versions';

        self::assertSame('manual', self::data($gm->post($url, []))['kind']);
        self::assertSame('manual', self::data($gm->post($url, ['kind' => 'manual']))['kind']);
        $pre = $gm->post($url, ['kind' => 'pre_generate', 'label' => 'Avant']);
        self::assertSame(201, $pre->status());
        self::assertSame('pre_generate', self::data($pre)['kind']);
        self::assertSame('pre_generate', self::data($gm->get($url))[0]['kind']);

        foreach (['auto', 'pre_restore', 'nope', '', 3, ['x']] as $bad) {
            self::assertFieldErrors($gm->post($url, ['kind' => $bad]), ['kind' => 'invalid']);
        }
    }

    public function testGenerationIsStoredReturnedAndCleared(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        self::assertNull($map['generation']);

        $r = $gm->patch('/maps/' . $map['id'], ['generation' => self::GENERATION]);
        self::assertSame(200, $r->status(), $r->body());
        self::assertArrayNotHasKey('generation', self::data($r));
        self::assertEqualsCanonicalizing(self::GENERATION, self::data($gm->get('/maps/' . $map['id']))['generation']);

        // With other fields, and params empty object.
        $gm->patch('/maps/' . $map['id'], ['name' => 'Neuf', 'generation' => ['generator' => 'cave', 'gen_version' => 2, 'seed' => 's', 'params' => []]]);
        $full = self::data($gm->get('/maps/' . $map['id']));
        self::assertSame('Neuf', $full['name']);
        self::assertSame('cave', $full['generation']['generator']);
        self::assertSame([], $full['generation']['params']);

        // A patch without generation keeps it; null clears it.
        $gm->patch('/maps/' . $map['id'], ['name' => 'Autre']);
        self::assertSame('cave', self::data($gm->get('/maps/' . $map['id']))['generation']['generator']);
        self::assertSame(200, $gm->patch('/maps/' . $map['id'], ['generation' => null])->status());
        self::assertNull(self::data($gm->get('/maps/' . $map['id']))['generation']);
    }

    public function testGenerationValidation(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        $url = '/maps/' . $map['id'];
        $g = self::GENERATION;

        self::assertFieldErrors($gm->patch($url, ['generation' => [...$g, 'generator' => '']]), ['generation.generator' => 'invalid']);
        self::assertFieldErrors($gm->patch($url, ['generation' => ['gen_version' => 1, 'seed' => 's']]), ['generation.generator' => 'required']);
        self::assertFieldErrors($gm->patch($url, ['generation' => [...$g, 'params' => ['a', 'b']]]), ['generation.params' => 'invalid']);
        self::assertFieldErrors($gm->patch($url, ['generation' => [...$g, 'params' => ['blob' => str_repeat('x', 70000)]]]), ['generation.params' => 'too_large']);
        self::assertFieldErrors($gm->patch($url, ['generation' => [...$g, 'seed' => '', 'gen_version' => 0]]), ['generation.seed' => 'invalid', 'generation.gen_version' => 'invalid']);
        self::assertFieldErrors($gm->patch($url, ['generation' => 'x']), ['generation' => 'invalid']);
        self::assertNull(self::data($gm->get($url))['generation']);
    }

    public function testAPlayerCannotPatchTheGeneration(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $map = $this->newMap($gm, $game['id']);
        $this->user('Bob');
        $this->addMember($gm, $game['id'], 'Bob');
        $player = $this->client('198.51.100.151');
        $player->login('Bob', self::PASSWORD);

        self::assertSame(403, $player->patch('/maps/' . $map['id'], ['generation' => self::GENERATION])->status());
        self::assertSame(403, $player->post('/maps/' . $map['id'] . '/versions', ['kind' => 'pre_generate'])->status());
        self::assertNull(self::data($gm->get('/maps/' . $map['id']))['generation']);
    }
}
