<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\Versions\MapVersionRepository;
use JDR\Maps\Document\MapDocumentValidator;
use JDR\Tests\Api\ApiClient;

/**
 * Map document 12.1 with the P5 content (objects, tokens_placed, fog): fixture v1-p5-sample.json
 * (non-regression), export / import round trip (JSON and ZIP, missing_tokens), refused
 * documents, duplication, version snapshot and restore.
 */
final class MapSceneDocumentTest extends MapsP5TestCase
{
    private const FIXTURE = 'v1-p5-sample.json';

    public function testFixtureIsValidAndNormalized(): void
    {
        $doc = (new MapDocumentValidator())->validate(self::fixtureDoc(self::FIXTURE));
        self::assertCount(8, $doc['objects']);
        self::assertCount(3, $doc['tokens_placed']);
        // 12.1 defaults: layer by type, visibility, locked, sort_order, reserved props.
        self::assertSame([
            'uid' => 'o1',
            'floor' => 'f1',
            'type' => 'wall',
            'layer' => 'walls',
            'geometry' => ['points' => [[10, 8], [20.5, 8], [20.5, 14.25]], 'closed' => false],
            'props' => ['kind' => 'wood', 'thickness' => 0.1, 'blocks_vision' => true, 'blocks_light' => false, 'blocks_move' => true, 'texture_asset' => null, 'height' => null],
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => 0,
        ], $doc['objects'][1]);
        self::assertSame(
            ['uid' => 't1', 'token' => 'Garde', 'token_id' => null, 'floor' => 'f2', 'x' => 59.5, 'y' => 0.5, 'rotation' => 359, 'scale' => 0.25, 'hidden' => false, 'light_override' => null],
            $doc['tokens_placed'][2],
        );
        self::assertSame(['f1', 'f1'], array_column($doc['fog'], 'floor'));
        self::assertSame(2048, strlen($doc['fog'][0]['raw']));
        self::assertSame(self::fogBits([[0, 0]]), $doc['fog'][1]['raw']);
    }

    public function testRefusedP5Content(): void
    {
        $cases = [
            'duplicate object uid (case)' => [static function (array $d): array {
                $d['objects'][1]['uid'] = 'WALL-ROOM-1';

                return $d;
            }, ['objects.1.uid' => 'duplicate']],
            'object on an unknown floor' => [static function (array $d): array {
                $d['objects'][0]['floor'] = 'f9';

                return $d;
            }, ['objects.0.floor' => 'not_found']],
            'object outside the grid' => [static function (array $d): array {
                $d['objects'][0]['geometry']['points'][1] = [60.5, 2];

                return $d;
            }, ['objects.0.geometry.points.1' => 'too_large']],
            'rev in a document' => [static function (array $d): array {
                $d['objects'][0]['rev'] = 1;

                return $d;
            }, ['objects.0' => 'invalid']],
            'P9 type' => [static function (array $d): array {
                $d['objects'][0]['type'] = 'label';

                return $d;
            }, ['objects.0.type' => 'invalid']],
            'light dim radius' => [static function (array $d): array {
                $d['objects'][5]['props']['dim_radius'] = 1;

                return $d;
            }, ['objects.5.props.dim_radius' => 'below_radius']],
            'token reference' => [static function (array $d): array {
                $d['tokens_placed'][0]['token'] = 'Garde';

                return $d;
            }, ['tokens_placed.0.token' => 'invalid']],
            'token name too long' => [static function (array $d): array {
                $d['tokens_placed'][0]['token'] = 'ref:token:' . str_repeat('g', 81);

                return $d;
            }, ['tokens_placed.0.token' => 'too_long']],
            'token_id outside snapshots' => [static function (array $d): array {
                $d['tokens_placed'][0]['token_id'] = 3;

                return $d;
            }, ['tokens_placed.0' => 'invalid']],
            'duplicate token uid' => [static function (array $d): array {
                $d['tokens_placed'][2]['uid'] = 'TOK-GUARD';

                return $d;
            }, ['tokens_placed.2.uid' => 'duplicate']],
            'token outside the grid' => [static function (array $d): array {
                $d['tokens_placed'][0]['y'] = 41;

                return $d;
            }, ['tokens_placed.0.y' => 'too_large']],
            'fog of an unknown floor' => [static function (array $d): array {
                $d['fog']['f9'] = $d['fog']['f1'];

                return $d;
            }, ['fog.f9' => 'not_found']],
            'fog block outside the grid' => [static function (array $d): array {
                $d['fog']['f1']['2:0'] = $d['fog']['f1']['0:0'];

                return $d;
            }, ['fog.f1.2:0' => 'out_of_bounds']],
            'fog block of the wrong size' => [static function (array $d): array {
                $d['fog']['f1']['0:0'] = base64_encode((string) gzdeflate(str_repeat("\1", 2047)));

                return $d;
            }, ['fog.f1.0:0' => 'invalid']],
            'fog as a list' => [static function (array $d): array {
                $d['fog'] = [['0:0' => 'x']];

                return $d;
            }, ['fog' => 'invalid']],
        ];
        $validator = new MapDocumentValidator();
        foreach ($cases as $label => [$trap, $expected]) {
            try {
                $validator->validate($trap(self::fixtureDoc(self::FIXTURE)));
                self::fail($label . ': accepted');
            } catch (ValidationException $e) {
                self::assertSame($expected, array_intersect_key($e->fields(), $expected), $label . ': ' . json_encode($e->fields()));
            }
        }
        // Through the API: 422, nothing written.
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $before = $this->rows('maps');
        $doc = $cases['token outside the grid'][0](self::fixtureDoc(self::FIXTURE));
        $response = $this->import($gm, $game['id'], self::scratchFile((string) json_encode($doc)));
        self::assertFieldErrors($response, ['tokens_placed.0.y' => 'too_large']);
        self::assertSame($before, $this->rows('maps'));
        self::assertSame(0, $this->rows('map_objects') + $this->rows('map_tokens') + $this->rows('map_fog'));
    }

    public function testImportResolvesTokensByNameAndRoundTrips(): void
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $guard = $this->newToken($gm, $game['id'], ['name' => 'Garde', 'kind' => 'npc']);
        $this->newToken($gm, $game['id'], ['name' => 'Garde', 'kind' => 'npc']); // second "Garde": first by id wins
        $this->newToken($gm, $game['id'], ['name' => 'gobelin', 'kind' => 'monster']); // case differs: not a match

        $result = $this->importOk($gm, $game['id'], self::mapFixture(self::FIXTURE), ['client_op_id' => 'imp-p5']);
        self::assertSame(['Gobelin'], $result['missing_tokens']);
        $map = $result['map'];
        [$f1, $f2] = array_column($map['floors'], 'id');
        // Sorted by floor, sort_order, id.
        self::assertSame(['wall-room-1', 'o1', 'torch-1', 'door-1', 'door-secret', 'window-1', 'spot-gm', 'crypt-wall'], array_column($map['objects'], 'uid'));
        self::assertSame([$f1, $f1, $f1, $f1, $f1, $f1, $f1, $f2], array_column($map['objects'], 'floor'));
        self::assertSame([1], array_values(array_unique(array_column($map['objects'], 'rev'))));
        self::assertSame(['tok-guard', 't1'], array_column($map['tokens_placed'], 'uid'));
        self::assertSame([$guard['id'], $guard['id']], array_column($map['tokens_placed'], 'token_id'));
        self::assertSame([$f1, $f2], array_column($map['tokens_placed'], 'floor'));
        self::assertSame(['0:0', '1:1'], array_keys($this->fogOf($gm, $map['id'], $f1)));
        self::assertSame([], $this->fogOf($gm, $map['id'], $f2));
        self::assertEquals([1.925, 1.925, 10.075, 8.075], $this->sceneRepository()->bboxes((int) $map['id'])['wall-room-1']);
        // Replay of the import: same answer, missing_tokens included.
        $replay = $this->importOk($gm, $game['id'], self::mapFixture(self::FIXTURE), ['client_op_id' => 'imp-p5']);
        self::assertSame($map['id'], $replay['map']['id']);
        self::assertSame(['Gobelin'], $replay['missing_tokens']);

        // Export: P5 content, no rev, tokens by name, fog in base64.
        $doc = $this->exportDoc($gm, $map['id']);
        $source = self::fixtureDoc(self::FIXTURE);
        self::assertSame($this->expectedObjects($source), $doc['objects']);
        self::assertSame([
            ['uid' => 'tok-guard', 'token' => 'ref:token:Garde', 'floor' => 'f1', 'x' => 5, 'y' => 5, 'rotation' => 0, 'scale' => 1, 'hidden' => false, 'light_override' => null],
            ['uid' => 't1', 'token' => 'ref:token:Garde', 'floor' => 'f2', 'x' => 59.5, 'y' => 0.5, 'rotation' => 359, 'scale' => 0.25, 'hidden' => false, 'light_override' => null],
        ], $doc['tokens_placed']);
        self::assertSame(['f1'], array_keys($doc['fog']));
        self::assertSame(
            array_map(static fn (string $b): string => (string) gzinflate((string) base64_decode($b, true)), $source['fog']['f1']),
            array_map(static fn (string $b): string => (string) gzinflate((string) base64_decode($b, true)), $doc['fog']['f1']),
        );

        // Re-import of the export (JSON and ZIP) in a game with both tokens: identical scene.
        $other = $this->newGame($gm, 'Autre');
        $this->newToken($gm, $other['id'], ['name' => 'Garde', 'kind' => 'npc']);
        $this->newToken($gm, $other['id'], ['name' => 'Gobelin', 'kind' => 'monster']);
        $json = (string) json_encode($doc);
        foreach ([self::scratchFile($json), self::zipFile($json)] as $file) {
            $again = $this->importOk($gm, $other['id'], $file);
            self::assertSame([], $again['missing_tokens']);
            $docAgain = $this->exportDoc($gm, $again['map']['id']);
            foreach (['objects', 'tokens_placed', 'fog', 'floors'] as $key) {
                self::assertSame($doc[$key], $docAgain[$key], $key);
            }
        }
    }

    public function testDuplicationCopiesTheScene(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard] = $this->p5Scene();
        $bits = self::fogBits([[4, 4]]);
        $this->opsOk($gm, $map['id'], [
            self::addObject(self::wall('w1', $f)),
            self::addObject(self::light('l1', $f)),
            self::addToken(self::placed('t1', $f, $guard['id'], ['hidden' => true])),
            self::fogOp('fog.reveal', $f, [[0, 0, $bits]]),
        ]);
        $this->opsOk($gm, $map['id'], [self::updateObject('w1', 1, ['locked' => true])]);
        $copy = self::data($gm->post('/maps/' . $map['id'] . '/duplicate', []));
        $f2 = $copy['floors'][0]['id'];
        self::assertNotSame($f, $f2);
        $strip = static fn (array $items, string $floor): array => array_map(
            static fn (array $o): array => array_replace($o, ['floor' => $floor, 'rev' => 1]),
            $items,
        );
        $source = self::data($gm->get('/maps/' . $map['id']));
        self::assertSame($strip($source['objects'], $f2), $copy['objects']);
        self::assertSame(1, $copy['objects'][0]['rev']);
        self::assertTrue($copy['objects'][0]['locked']);
        self::assertSame($strip($source['tokens_placed'], $f2), $copy['tokens_placed']);
        self::assertSame(['0:0' => $bits], $this->fogOf($gm, $copy['id'], $f2));
        self::assertSame($this->sceneRepository()->bboxes((int) $map['id']), $this->sceneRepository()->bboxes((int) $copy['id']));
        // Independent copies.
        $this->opsOk($gm, $copy['id'], [['type' => 'object.remove', 'uid' => 'w1']]);
        self::assertArrayHasKey('w1', $this->objectsOf($gm, $map['id']));
    }

    public function testVersionSnapshotAndRestore(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'guard' => $guard, 'goblin' => $goblin, 'game' => $game] = $this->p5Scene();
        $bits = self::fogBits([[0, 0], [9, 9]]);
        $this->opsOk($gm, $map['id'], [
            self::addObject(self::wall('w1', $f)),
            self::addObject(self::door('d1', $f)),
            self::addToken(self::placed('t-guard', $f, $guard['id'])),
            self::addToken(self::placed('t-gob', $f, $goblin['id'], ['x' => 9])),
            self::fogOp('fog.reveal', $f, [[0, 0, $bits]]),
        ]);
        $version = self::data($gm->post('/maps/' . $map['id'] . '/versions', ['label' => 'Avant']));
        $before = self::data($gm->get('/maps/' . $map['id']));

        // The internal snapshot carries token_id.
        $blob = (string) $this->app()->container()->get(MapVersionRepository::class)->snapshot((int) $version['id']);
        $snapshot = json_decode((string) gzdecode($blob), true);
        self::assertSame((int) $guard['id'], $snapshot['tokens_placed'][0]['token_id']);
        self::assertArrayNotHasKey('rev', $snapshot['objects'][0]);

        // Everything changes, then the goblin definition is deleted.
        $this->opsOk($gm, $map['id'], [
            ['type' => 'object.remove', 'uid' => 'w1'],
            self::updateObject('d1', 1, ['props' => self::doorProps(['state' => 'open'])]),
            self::addObject(self::light('l-new', $f)),
            ['type' => 'maptoken.update', 'uid' => 't-guard', 'rev' => 1, 'patch' => ['x' => 30]],
            self::fogOp('fog.hide', $f, [[0, 0, $bits]]),
            self::fogOp('fog.reveal', $f, [[1, 1, $bits]]),
        ]);
        self::assertSame(204, $gm->delete('/tokens/' . $goblin['id'])->status());

        $restored = $gm->post('/maps/' . $map['id'] . '/versions/' . $version['id'] . '/restore', []);
        self::assertSame(200, $restored->status(), $restored->body());
        $after = self::data($restored)['map'];
        $rev1 = static fn (array $items): array => array_map(static fn (array $o): array => array_replace($o, ['rev' => 1]), $items);
        self::assertSame($rev1($before['objects']), $after['objects']);
        self::assertSame(['t-guard'], array_column($after['tokens_placed'], 'uid'), 'the goblin definition is gone: dropped');
        self::assertSame($before['tokens_placed'][0], $after['tokens_placed'][0]);
        self::assertSame(['0:0' => $bits], $this->fogOf($gm, $map['id'], $f));

        // The pre_restore snapshot holds the state before the restore: restoring it brings it back.
        $versions = self::data($gm->get('/maps/' . $map['id'] . '/versions'));
        $pre = array_values(array_filter($versions, static fn (array $v): bool => $v['kind'] === 'pre_restore'))[0];
        $this->assertRestored($gm, $map['id'], $pre['id'], ['d1', 'l-new'], ['1:1']);
        // Restore by name: the guard definition is replaced by another "Garde".
        self::assertSame(204, $gm->delete('/tokens/' . $guard['id'])->status());
        $newGuard = $this->newToken($gm, $game['id'], ['name' => 'Garde', 'kind' => 'npc']);
        $again = self::data($gm->post('/maps/' . $map['id'] . '/versions/' . $version['id'] . '/restore', []))['map'];
        self::assertSame([$newGuard['id']], array_column($again['tokens_placed'], 'token_id'));
    }

    /**
     * @param list<string> $objects
     * @param list<string> $fog
     */
    private function assertRestored(ApiClient $gm, string $mapId, string $versionId, array $objects, array $fog): void
    {
        $r = $gm->post('/maps/' . $mapId . '/versions/' . $versionId . '/restore', []);
        self::assertSame(200, $r->status(), $r->body());
        $map = self::data($r)['map'];
        self::assertSame($objects, array_column($map['objects'], 'uid'));
        self::assertSame('open', $map['objects'][0]['props']['state']);
        self::assertSame($fog, array_keys($this->fogOf($gm, $mapId, $map['floors'][0]['id'])));
    }

    /**
     * Objects of the fixture as the server writes them back (defaults filled, canonical order).
     *
     * @param array<string, mixed> $source
     * @return list<array<string, mixed>>
     */
    private function expectedObjects(array $source): array
    {
        $normalized = (new MapDocumentValidator())->validate($source)['objects'];
        // Sorted by floor, sort_order, id (insertion order) like the export.
        $order = array_flip(array_column($source['floors'], 'uid'));
        $indexed = [];
        foreach ($normalized as $i => $o) {
            $indexed[] = [$order[$o['floor']], $o['sort_order'], $i, $o];
        }
        usort($indexed, static fn (array $a, array $b): int => [$a[0], $a[1], $a[2]] <=> [$b[0], $b[1], $b[2]]);

        return array_column($indexed, 3);
    }
}
