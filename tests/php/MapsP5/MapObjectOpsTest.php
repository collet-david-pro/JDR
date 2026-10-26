<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP5;

use JDR\Maps\ObjectRules;

/**
 * object.add / object.update / object.remove in POST /maps/{id}/ops (etapes/P05 "Contrat d'API
 * P5"): validation of every field, conflicts (exists, gone, stale), rev, bounding boxes,
 * rounding, revision rules, idempotence with conflicts, limits.
 */
final class MapObjectOpsTest extends MapsP5TestCase
{
    public function testAddUpdateRemoveRoundTrip(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $wall = self::wall('w1', $f, [[2, 2], [10.12345, 2.0004], [10, 8]], ['rev' => 7, 'sort_order' => -5]);
        $result = $this->opsOk($gm, $map['id'], [
            self::addObject($wall),
            self::addObject(self::door('d1', $f)),
            self::addObject(self::window('win1', $f)),
            self::addObject(self::light('l1', $f, 10, 10, ['props' => self::lightProps(['cone' => ['angle' => 90, 'direction' => 45.5]])])),
        ]);
        self::assertSame(['revision' => 1, 'applied' => 4, 'conflicts' => []], $result);

        $objects = $this->objectsOf($gm, $map['id']);
        self::assertSame(['w1', 'd1', 'win1', 'l1'], array_keys($objects), 'sorted by floor, sort_order, id');
        // rev ignored on add (1), coordinates rounded to 3 decimals, key order of the contract.
        self::assertSame([
            'uid' => 'w1',
            'floor' => $f,
            'type' => 'wall',
            'layer' => 'walls',
            'geometry' => ['points' => [[2, 2], [10.123, 2], [10, 8]], 'closed' => false],
            'props' => self::wallProps(),
            'visibility' => 'all',
            'locked' => false,
            'sort_order' => -5,
            'rev' => 1,
        ], $objects['w1']);
        self::assertSame(['angle' => 90, 'direction' => 45.5], $objects['l1']['props']['cone']);
        self::assertSame(['type' => 'torch', 'amp' => 0.2, 'speed' => 2], $objects['l1']['props']['flicker']);

        // Update: patch merged, geometry replaced, rev + 1 each time.
        $r = $this->opsOk($gm, $map['id'], [
            self::updateObject('w1', 1, ['geometry' => ['points' => [[1, 1], [3, 3]], 'closed' => true], 'locked' => true]),
            self::updateObject('w1', 2, ['props' => self::wallProps(['kind' => 'wood', 'thickness' => 0.5]), 'layer' => 'gm', 'visibility' => 'gm']),
            self::updateObject('d1', 1, ['props' => self::doorProps(['state' => 'open', 'swing' => 'slide']), 'sort_order' => 9]),
        ]);
        self::assertSame(['revision' => 2, 'applied' => 3, 'conflicts' => []], $r);
        $objects = $this->objectsOf($gm, $map['id']);
        self::assertSame(3, $objects['w1']['rev']);
        self::assertSame(['points' => [[1, 1], [3, 3]], 'closed' => true], $objects['w1']['geometry']);
        self::assertSame('wood', $objects['w1']['props']['kind']);
        self::assertSame(['gm', 'gm', true], [$objects['w1']['layer'], $objects['w1']['visibility'], $objects['w1']['locked']]);
        self::assertSame(['open', 'slide', 9, 2], [$objects['d1']['props']['state'], $objects['d1']['props']['swing'], $objects['d1']['sort_order'], $objects['d1']['rev']]);

        // Remove: idempotent; an unknown uid is not an applied op.
        $r = $this->opsOk($gm, $map['id'], [
            ['type' => 'object.remove', 'uid' => 'win1'],
            ['type' => 'object.remove', 'uid' => 'win1'],
            ['type' => 'object.remove', 'uid' => 'nope'],
        ]);
        self::assertSame(['revision' => 3, 'applied' => 1, 'conflicts' => []], $r);
        self::assertArrayNotHasKey('win1', $this->objectsOf($gm, $map['id']));
        $r = $this->opsOk($gm, $map['id'], [['type' => 'object.remove', 'uid' => 'win1']]);
        self::assertSame(['revision' => 3, 'applied' => 0, 'conflicts' => []], $r, 'nothing applied: revision unchanged');
        self::assertSame(3, $this->revision($map['id']));
    }

    public function testConflictsAreReportedIndividually(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $this->opsOk($gm, $map['id'], [self::addObject(self::wall('w1', $f)), self::addObject(self::light('l1', $f))]);
        $this->opsOk($gm, $map['id'], [self::updateObject('w1', 1, ['sort_order' => 3])]); // w1 rev 2
        $stored = $this->objectsOf($gm, $map['id']);

        $clientOpId = 'conflicts-1';
        $response = $this->sendOps($gm, $map['id'], [
            self::addObject(self::wall('w1', $f, [[0, 0], [1, 1]])),          // exists
            self::updateObject('w1', 1, ['sort_order' => 4]),                   // stale (rev 2 stored)
            self::updateObject('ghost', 5, ['locked' => true]),                // gone
            self::updateObject('l1', 1, ['geometry' => ['x' => 1, 'y' => 2]]), // applied
            self::addObject(self::wall('W1', $f)),                              // exists, case-insensitive key
        ], null, $clientOpId);
        self::assertSame(200, $response->status(), $response->body());
        $data = self::data($response);
        self::assertSame(3, $data['revision']);
        self::assertSame(1, $data['applied']);
        self::assertSame([
            ['op_index' => 0, 'kind' => 'object', 'uid' => 'w1', 'reason' => 'exists', 'current' => $stored['w1']],
            ['op_index' => 1, 'kind' => 'object', 'uid' => 'w1', 'reason' => 'stale', 'current' => $stored['w1']],
            ['op_index' => 2, 'kind' => 'object', 'uid' => 'ghost', 'reason' => 'gone', 'current' => null],
            ['op_index' => 4, 'kind' => 'object', 'uid' => 'W1', 'reason' => 'exists', 'current' => $stored['w1']],
        ], $data['conflicts']);
        self::assertSame(['x' => 1, 'y' => 2], $this->objectsOf($gm, $map['id'])['l1']['geometry']);
        self::assertSame($stored['w1'], $this->objectsOf($gm, $map['id'])['w1'], 'conflicting ops change nothing');

        // Replay: the same response (conflicts included, same key order), nothing re-applied.
        $replay = $this->sendOps($gm, $map['id'], [], 0, $clientOpId);
        self::assertSame(200, $replay->status());
        self::assertSame($data, self::data($replay));
        self::assertSame(3, $this->revision($map['id']));

        // Only conflicts: the revision does not move, the response is remembered too.
        $only = $this->sendOps($gm, $map['id'], [self::updateObject('w1', 0, ['locked' => true])], null, 'conflicts-2');
        self::assertSame(['revision' => 3, 'applied' => 0], array_slice(self::data($only), 0, 2));
        self::assertSame('stale', self::data($only)['conflicts'][0]['reason']);
        self::assertSame(self::data($only), self::data($this->sendOps($gm, $map['id'], [], 0, 'conflicts-2')));
        self::assertSame(3, $this->revision($map['id']));

        // An update with a rev higher than the stored one is applied (rev = stored + 1).
        $this->opsOk($gm, $map['id'], [self::updateObject('w1', 99, ['locked' => true])]);
        self::assertSame(3, $this->objectsOf($gm, $map['id'])['w1']['rev']);
    }

    public function testDeletionWinsOverAConcurrentUpdate(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f, 'game' => $game] = $this->p5Scene();
        $this->addMember($gm, $game['id'], 'Bob', 'co_gm');
        $bob = $this->login('Bob');
        $this->opsOk($gm, $map['id'], [self::addObject(self::door('d1', $f))]);
        // Two editors base an update on rev 1: the first wins, the second is stale.
        $first = $this->opsOk($gm, $map['id'], [self::updateObject('d1', 1, ['props' => self::doorProps(['state' => 'open'])])]);
        self::assertSame([], $first['conflicts']);
        $second = $this->opsOk($bob, $map['id'], [self::updateObject('d1', 1, ['props' => self::doorProps(['locked' => true])])]);
        self::assertSame('stale', $second['conflicts'][0]['reason']);
        self::assertSame('open', $second['conflicts'][0]['current']['props']['state']);
        // Bob removes it; Alice's late update finds it gone.
        $this->opsOk($bob, $map['id'], [['type' => 'object.remove', 'uid' => 'd1']]);
        $late = $this->opsOk($gm, $map['id'], [self::updateObject('d1', 2, ['locked' => true])]);
        self::assertSame([['op_index' => 0, 'kind' => 'object', 'uid' => 'd1', 'reason' => 'gone', 'current' => null]], $late['conflicts']);
        self::assertSame([], self::data($gm->get('/maps/' . $map['id']))['objects']);
    }

    public function testBoundingBoxes(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $this->opsOk($gm, $map['id'], [
            self::addObject(self::wall('w', $f, [[2, 3], [10, 1], [6, 8]], ['props' => self::wallProps(['thickness' => 0.5])])),
            self::addObject(self::wall('edge', $f, [[0, 0], [60, 40]], ['props' => self::wallProps(['thickness' => 2])])),
            self::addObject(self::door('d', $f, [6.5, 2], [5, 3])),
            self::addObject(self::light('l', $f, 3, 38, ['props' => self::lightProps(['radius' => 2, 'dim_radius' => 5.25])])),
        ]);
        $bboxes = $this->sceneRepository()->bboxes((int) $map['id']);
        self::assertEquals([1.75, 0.75, 10.25, 8.25], $bboxes['w']);
        self::assertEquals([0, 0, 60, 40], $bboxes['edge'], 'bounded to the map');
        self::assertEquals([5, 2, 6.5, 3], $bboxes['d']);
        self::assertEquals([0, 32.75, 8.25, 40], $bboxes['l']);
        // Updated with the geometry / props.
        $this->opsOk($gm, $map['id'], [self::updateObject('l', 1, ['props' => self::lightProps(['radius' => 0, 'dim_radius' => 1])])]);
        self::assertEquals([2, 37, 4, 39], $this->sceneRepository()->bboxes((int) $map['id'])['l']);

        // GET /maps/{id}/objects?floor=&bbox=
        $query = static fn (string $bbox): array => array_column(
            self::data($gm->get('/maps/' . $map['id'] . '/objects?floor=' . $f . ($bbox === '' ? '' : '&bbox=' . $bbox)))['objects'],
            'uid',
        );
        self::assertSame(['w', 'edge', 'd', 'l'], $query(''));
        self::assertSame(['edge'], $query('0,36,1.9,40'));
        self::assertSame(['edge', 'l'], $query('0,36,2,40'));
        self::assertSame(['w', 'edge', 'd'], $query('5.5,2.5,5.6,2.6'));
        self::assertSame(['w', 'edge'], $query('10.25,8.25,11,9'), 'edges touch');
        foreach (['1,2,3', 'a,b,c,d', '5,5,1,1', '1,1,2,2,3'] as $bad) {
            self::assertFieldErrors($gm->get('/maps/' . $map['id'] . '/objects?floor=' . $f . '&bbox=' . $bad), ['bbox' => 'invalid']);
        }
        self::assertFieldErrors($gm->get('/maps/' . $map['id'] . '/objects'), ['floor' => 'required']);
    }

    public function testObjectValidation(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $this->opsOk($gm, $map['id'], [self::addObject(self::wall('w1', $f)), self::addObject(self::light('l1', $f))]);
        $rev = $this->revision($map['id']);
        $w = static fn (array $over): array => self::addObject(self::wall('n1', $f, [[2, 2], [10, 2]], $over));
        $l = static fn (array $props): array => self::addObject(self::light('n1', $f, 10, 10, ['props' => self::lightProps($props)]));
        $d = static fn (array $a, array $b, array $over = []): array => self::addObject(self::door('n1', $f, $a, $b, $over));
        $unset = static function (array $object, string $key): array {
            unset($object[$key]);

            return self::addObject($object);
        };
        $cases = [
            // Common members.
            [['type' => 'object.add'], ['ops.0.object' => 'required']],
            [['type' => 'object.add', 'object' => []], ['ops.0.object' => 'invalid']],
            [['type' => 'object.add', 'object' => self::wall('n1', $f) + ['extra' => 1]], ['ops.0.object' => 'invalid']],
            [self::addObject(self::wall('n1', $f)) + ['extra' => 1], ['ops.0' => 'invalid']],
            [$w(['uid' => 'a b']), ['ops.0.object.uid' => 'invalid']],
            [$w(['uid' => str_repeat('x', 22)]), ['ops.0.object.uid' => 'invalid']],
            [$w(['uid' => '']), ['ops.0.object.uid' => 'required']],
            [$unset(self::wall('n1', $f), 'uid'), ['ops.0.object.uid' => 'required']],
            [$w(['floor' => 'abc']), ['ops.0.object.floor' => 'invalid']],
            [$w(['floor' => '999999']), ['ops.0.object.floor' => 'not_found']],
            [$w(['type' => 'prop']), ['ops.0.object.type' => 'invalid']],
            [$w(['type' => 'label']), ['ops.0.object.type' => 'invalid']],
            [$w(['layer' => 'ground']), ['ops.0.object.layer' => 'invalid']],
            [$unset(self::wall('n1', $f), 'layer'), ['ops.0.object.layer' => 'required']],
            [$w(['visibility' => 'players']), ['ops.0.object.visibility' => 'invalid']],
            [$w(['locked' => 1]), ['ops.0.object.locked' => 'invalid']],
            [$w(['sort_order' => 1.5]), ['ops.0.object.sort_order' => 'invalid']],
            [$w(['sort_order' => 1000001]), ['ops.0.object.sort_order' => 'too_large']],
            [$w(['sort_order' => -1000001]), ['ops.0.object.sort_order' => 'too_small']],
            [$w(['rev' => 'x']), ['ops.0.object.rev' => 'invalid']],
            [$unset(self::wall('n1', $f), 'props'), ['ops.0.object.props' => 'required']],
            // Wall.
            [$w(['geometry' => ['points' => [[1, 1]], 'closed' => false]]), ['ops.0.object.geometry.points' => 'too_small']],
            [$w(['geometry' => ['points' => array_fill(0, 1001, [1, 1]), 'closed' => false]]), ['ops.0.object.geometry.points' => 'too_many']],
            [$w(['geometry' => ['points' => [[1, 1], [60.001, 1]], 'closed' => false]]), ['ops.0.object.geometry.points.1' => 'too_large']],
            [$w(['geometry' => ['points' => [[1, 1], [1, 40.5]], 'closed' => false]]), ['ops.0.object.geometry.points.1' => 'too_large']],
            [$w(['geometry' => ['points' => [[-1, 1], [1, 1]], 'closed' => false]]), ['ops.0.object.geometry.points.0' => 'too_small']],
            [$w(['geometry' => ['points' => [[1, 1], [1, '2']], 'closed' => false]]), ['ops.0.object.geometry.points.1' => 'invalid']],
            [$w(['geometry' => ['points' => [[1, 1], [1, 2, 3]], 'closed' => false]]), ['ops.0.object.geometry.points.1' => 'invalid']],
            [$w(['geometry' => ['points' => [[1, 1], [1, 2]], 'closed' => 'no']]), ['ops.0.object.geometry.closed' => 'invalid']],
            [$w(['geometry' => ['points' => [[1, 1], [1, 2]]]]), ['ops.0.object.geometry.closed' => 'required']],
            [$w(['geometry' => ['a' => [1, 1], 'b' => [2, 2]]]), ['ops.0.object.geometry' => 'invalid']],
            [$w(['props' => self::wallProps(['kind' => 'glass'])]), ['ops.0.object.props.kind' => 'invalid']],
            [$w(['props' => self::wallProps(['thickness' => 0.04])]), ['ops.0.object.props.thickness' => 'too_small']],
            [$w(['props' => self::wallProps(['thickness' => 2.5])]), ['ops.0.object.props.thickness' => 'too_large']],
            [$w(['props' => self::wallProps(['blocks_vision' => 'yes'])]), ['ops.0.object.props.blocks_vision' => 'invalid']],
            [$w(['props' => self::wallProps(['texture_asset' => 'sha256:abc'])]), ['ops.0.object.props.texture_asset' => 'invalid']],
            [$w(['props' => self::wallProps(['height' => 21])]), ['ops.0.object.props.height' => 'too_large']],
            [$w(['props' => array_diff_key(self::wallProps(), ['height' => 1])]), ['ops.0.object.props.height' => 'required']],
            [$w(['props' => self::wallProps() + ['color' => '#fff']]), ['ops.0.object.props' => 'invalid']],
            // Door / window.
            [$d([5, 2], [5.05, 2]), ['ops.0.object.geometry' => 'too_small']],
            [$d([0, 0], [20, 10]), ['ops.0.object.geometry' => 'too_large']],
            [$d([55, 2], [61, 2]), ['ops.0.object.geometry.b' => 'too_large']],
            [$d([5, 2], [6, 2], ['props' => self::doorProps(['state' => 'ajar'])]), ['ops.0.object.props.state' => 'invalid']],
            [$d([5, 2], [6, 2], ['props' => self::doorProps(['swing' => 'c'])]), ['ops.0.object.props.swing' => 'invalid']],
            [$d([5, 2], [6, 2], ['props' => self::doorProps(['secret' => 0])]), ['ops.0.object.props.secret' => 'invalid']],
            [$d([5, 2], [6, 2], ['props' => self::doorProps(['asset_open' => 'x'])]), ['ops.0.object.props.asset_open' => 'invalid']],
            [$d([5, 2], [6, 2], ['props' => array_diff_key(self::doorProps(), ['asset_closed' => 1])]), ['ops.0.object.props.asset_closed' => 'required']],
            [self::addObject(self::window('n1', $f, ['props' => ['kind' => 'stone']])), ['ops.0.object.props.kind' => 'invalid']],
            [self::addObject(self::window('n1', $f, ['geometry' => ['a' => [2, 4]]])), ['ops.0.object.geometry.b' => 'required']],
            // Light.
            [self::addObject(self::light('n1', $f, 61, 1)), ['ops.0.object.geometry.x' => 'too_large']],
            [self::addObject(self::light('n1', $f, 1, -0.5)), ['ops.0.object.geometry.y' => 'too_small']],
            [$l(['radius' => 101]), ['ops.0.object.props.radius' => 'too_large']],
            [$l(['dim_radius' => 101]), ['ops.0.object.props.dim_radius' => 'too_large']],
            [$l(['radius' => 5, 'dim_radius' => 4]), ['ops.0.object.props.dim_radius' => 'below_radius']],
            [$l(['color' => 'orange']), ['ops.0.object.props.color' => 'invalid']],
            [$l(['intensity' => 1.5]), ['ops.0.object.props.intensity' => 'too_large']],
            [$l(['flicker' => ['type' => 'storm', 'amp' => 0, 'speed' => 1]]), ['ops.0.object.props.flicker.type' => 'invalid']],
            [$l(['flicker' => ['type' => 'none', 'amp' => 2, 'speed' => 1]]), ['ops.0.object.props.flicker.amp' => 'too_large']],
            [$l(['flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 0.05]]), ['ops.0.object.props.flicker.speed' => 'too_small']],
            [$l(['flicker' => ['type' => 'none', 'amp' => 0]]), ['ops.0.object.props.flicker.speed' => 'required']],
            [$l(['flicker' => true]), ['ops.0.object.props.flicker' => 'invalid']],
            [$l(['cone' => ['angle' => 0, 'direction' => 0]]), ['ops.0.object.props.cone.angle' => 'too_small']],
            [$l(['cone' => ['angle' => 360, 'direction' => 0]]), ['ops.0.object.props.cone.angle' => 'too_large']],
            [$l(['cone' => ['angle' => 90, 'direction' => 361]]), ['ops.0.object.props.cone.direction' => 'too_large']],
            [$l(['cone' => ['angle' => 90]]), ['ops.0.object.props.cone.direction' => 'required']],
            [$l(['enabled' => null]), ['ops.0.object.props.enabled' => 'invalid']],
            [$l(['follows_token' => 'a b']), ['ops.0.object.props.follows_token' => 'invalid']],
            // object.update.
            [['type' => 'object.update', 'uid' => 'w1', 'rev' => 1], ['ops.0.patch' => 'required']],
            [self::updateObject('w1', 1, []), ['ops.0.patch' => 'invalid']],
            [self::updateObject('w1', 1, ['type' => 'door']), ['ops.0.patch' => 'invalid']],
            [self::updateObject('w1', 1, ['uid' => 'x']), ['ops.0.patch' => 'invalid']],
            [['type' => 'object.update', 'uid' => 'w1', 'patch' => ['locked' => true]], ['ops.0.rev' => 'required']],
            [self::updateObject('w1', -1, ['locked' => true]), ['ops.0.rev' => 'invalid']],
            [['type' => 'object.update', 'rev' => 1, 'patch' => ['locked' => true]], ['ops.0.uid' => 'required']],
            [self::updateObject('w1', 1, ['visibility' => 'x']), ['ops.0.patch.visibility' => 'invalid']],
            [self::updateObject('w1', 1, ['layer' => 'decor']), ['ops.0.patch.layer' => 'invalid']],
            [self::updateObject('w1', 1, ['sort_order' => 'top']), ['ops.0.patch.sort_order' => 'invalid']],
            [self::updateObject('w1', 1, ['geometry' => [[1, 1]]]), ['ops.0.patch.geometry' => 'invalid']],
            // Geometry / props checked against the STORED type.
            [self::updateObject('w1', 1, ['geometry' => ['x' => 1, 'y' => 1]]), ['ops.0.patch.geometry' => 'invalid']],
            [self::updateObject('w1', 1, ['props' => self::lightProps()]), ['ops.0.patch.props' => 'invalid']],
            [self::updateObject('l1', 1, ['props' => self::lightProps(['radius' => 9, 'dim_radius' => 8])]), ['ops.0.patch.props.dim_radius' => 'below_radius']],
            [self::updateObject('l1', 1, ['geometry' => ['x' => 70, 'y' => 1]]), ['ops.0.patch.geometry.x' => 'too_large']],
            // object.remove.
            [['type' => 'object.remove'], ['ops.0.uid' => 'required']],
            [['type' => 'object.remove', 'uid' => 'a/b'], ['ops.0.uid' => 'invalid']],
            [['type' => 'object.remove', 'uid' => 'w1', 'rev' => 1], ['ops.0' => 'invalid']],
        ];
        foreach ($cases as $i => [$op, $errors]) {
            $response = $this->sendOps($gm, $map['id'], [$op]);
            self::assertSame(422, $response->status(), 'case ' . $i . ': ' . $response->body());
            self::assertFieldErrors($response, $errors);
            self::assertSame($rev, $this->revision($map['id']), 'case ' . $i);
        }
        // All or nothing: valid ops of a refused lot are not applied.
        $this->opsFail($gm, $map['id'], [
            self::addObject(self::wall('ok1', $f)),
            ['type' => 'object.remove', 'uid' => 'w1'],
            $w(['props' => self::wallProps(['kind' => 'glass'])]),
        ], ['ops.2.object.props.kind' => 'invalid']);
        self::assertSame(['w1', 'l1'], array_keys($this->objectsOf($gm, $map['id'])));
        // A map smaller than the largest grid: coordinates checked against the map.
        $small = $this->newMap($gm, $map['game_id'], ['name' => 'Petite', 'width' => 10, 'height' => 10]);
        $this->opsFail($gm, $small['id'], [self::addObject(self::light('x', $small['floors'][0]['id'], 10.5, 1))], ['ops.0.object.geometry.x' => 'too_large']);
        $this->opsOk($gm, $small['id'], [self::addObject(self::light('x', $small['floors'][0]['id'], 10, 10))]);
        // A floor of another map.
        $this->opsFail($gm, $map['id'], [self::addObject(self::wall('n1', $small['floors'][0]['id']))], ['ops.0.object.floor' => 'not_found']);
    }

    public function testDocumentDefaultsAreRefusedInOps(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        $wall = self::wall('w1', $f);
        unset($wall['visibility'], $wall['locked'], $wall['sort_order']);
        $wall['props'] = array_diff_key(self::wallProps(), ['texture_asset' => 1]);
        $this->opsFail($gm, $map['id'], [self::addObject($wall)], [
            'ops.0.object.visibility' => 'required',
            'ops.0.object.locked' => 'required',
            'ops.0.object.sort_order' => 'required',
        ]);
    }

    public function testObjectLimitPerMap(): void
    {
        ['gm' => $gm, 'map' => $map, 'floor' => $f] = $this->p5Scene();
        // Fill the map up to the limit with direct rows (cheaper than 100 lots of ops).
        $t = $this->db->t('map_objects');
        $now = gmdate('Y-m-d H:i:s');
        $rows = [];
        for ($i = 0; $i < ObjectRules::MAX_OBJECTS - 1; $i++) {
            $rows[] = "('x" . $i . "', " . (int) $map['id'] . ', ' . (int) $f . ", 'walls', 'wall', '{}', '{}', 0, 0, 0, 0, '" . $now . "')";
            if (count($rows) === 2000) {
                $this->db->execute('INSERT INTO ' . $t . ' (`uid`, `map_id`, `floor_id`, `layer`, `type`, `geometry`, `props`, `bbox_x1`, `bbox_y1`, `bbox_x2`, `bbox_y2`, `updated_at`) VALUES ' . implode(', ', $rows));
                $rows = [];
            }
        }
        if ($rows !== []) {
            $this->db->execute('INSERT INTO ' . $t . ' (`uid`, `map_id`, `floor_id`, `layer`, `type`, `geometry`, `props`, `bbox_x1`, `bbox_y1`, `bbox_x2`, `bbox_y2`, `updated_at`) VALUES ' . implode(', ', $rows));
        }
        // One more fits, the next one is refused (whole lot).
        $this->opsFail($gm, $map['id'], [self::addObject(self::wall('last', $f)), self::addObject(self::wall('over', $f))], ['ops.1' => 'too_many']);
        $this->opsOk($gm, $map['id'], [self::addObject(self::wall('last', $f))]);
        // A removal frees a place within the same lot.
        $this->opsOk($gm, $map['id'], [['type' => 'object.remove', 'uid' => 'x0'], self::addObject(self::wall('over', $f))]);
        self::assertSame(ObjectRules::MAX_OBJECTS, $this->rows('map_objects', '`map_id` = ?', [(int) $map['id']]));
    }
}
