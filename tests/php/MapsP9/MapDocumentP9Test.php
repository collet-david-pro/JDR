<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9;

use JDR\Tests\MapsP5\MapsP5TestCase;

/**
 * Multi-floor documents with links: export, import (links attached by map name, else broken),
 * duplication, version restore after floor.add / floor.remove (P9a1).
 */
final class MapDocumentP9Test extends MapsP5TestCase
{
    use P9Helpers;

    /**
     * @return array<string, mixed>
     */
    private function built(): array
    {
        $s = $this->twoMaps();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $asset = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $this->opsOk($gm, $m, [self::paletteAdd(1, $asset['id']), self::floorAdd('cave', 'Cave', -1), self::floorAdd('up', 'Étage', 1)]);
        $link = ['map_id' => $s['b']['id'], 'floor' => 'f1', 'x' => 2, 'y' => 3];
        $this->opsOk($gm, $m, [
            self::tiles('cave', 'ground', [[1, 1, 1]]),
            self::addObject(self::stairs('st', 'f1', 'up', [], ['link' => ['map_id' => $s['a']['id'], 'floor' => 'cave', 'x' => 1, 'y' => 1]])),
            self::addObject(self::portal('po', 'up', $link, [], ['label' => 'Village'])),
            self::addObject(self::wall('wc', 'cave', [[1, 1], [4, 1]])),
        ]);

        return $s;
    }

    public function testExportKeepsFloorUidsAndLinks(): void
    {
        $s = $this->built();
        $doc = $this->exportDoc($s['gm'], (string) $s['a']['id']);
        self::assertSame(['cave', 'f1', 'up'], array_column($doc['floors'], 'uid'));
        $objects = array_column($doc['objects'], null, 'uid');
        self::assertSame('up', $objects['st']['props']['to_floor']);
        self::assertSame('Village', $objects['po']['props']['link']['map_name']);
        self::assertSame('up', $objects['po']['floor']);
        self::assertSame('cave', $objects['wc']['floor']);
        self::assertSame(1, $doc['format_version']);
    }

    public function testImportAttachesLinksByNameElseBreaksThem(): void
    {
        $s = $this->built();
        $gm = $s['gm'];
        $file = self::scratchFile(json_encode($this->exportDoc($gm, (string) $s['a']['id'])));
        // Same game: "Village" exists, "Donjon" (the stairs target, which is the exported map itself) = the new map.
        $new = $this->importOk($gm, $s['game'], $file, []);
        $nm = (string) ($new['map']['id'] ?? $new['id']);
        $links = self::data($this->ok($gm->get('/maps/' . $nm . '/links')));
        $byObject = array_column($links['outgoing'], null, 'object_uid');
        self::assertEquals((int) $s['b']['id'], $byObject['po']['to']['map_id']);
        self::assertSame('f1', $byObject['po']['to']['floor']);
        self::assertEquals((int) $nm, $byObject['st']['to']['map_id'], 'a link to the map itself follows the copy');
        self::assertSame(['cave', 'f1', 'up'], array_column($this->floorsOf($gm, $nm), 'uid'));
        // Another game: no map of those names -> broken links kept.
        $other = (string) $this->newGame($gm)['id'];
        $imp = $this->importOk($gm, $other, $file, []);
        $im = (string) ($imp['map']['id'] ?? $imp['id']);
        $objects = array_column(self::data($this->ok($gm->get('/maps/' . $im)))['objects'], null, 'uid');
        self::assertSame(['map_id' => null, 'floor' => 'f1', 'x' => 2, 'y' => 3, 'map_name' => 'Village', 'broken' => true], $objects['po']['props']['link']);
        self::assertSame(1, $this->rows('map_links', '`from_map_id` = ?', [(int) $im]), 'only the link of the stairs to the map itself is attached');
        self::assertSame('up', $objects['st']['props']['to_floor']);
        // The document survives a second round trip (broken links are valid in documents).
        $again = self::scratchFile(json_encode($this->exportDoc($gm, $im)));
        $this->importOk($gm, $other, $again, []);
    }

    public function testNumericFloorUidsOfADocumentAreRenumbered(): void
    {
        $s = $this->twoMaps();
        $doc = $this->exportDoc($s['gm'], (string) $s['a']['id']);
        $doc['floors'] = [['uid' => '12', 'level' => 0, 'name' => 'Rez'], ['uid' => 'f1', 'level' => 1, 'name' => 'Haut']];
        $doc['chunks'] = new \stdClass();
        $doc['fog'] = new \stdClass();
        $doc['objects'] = [self::stairs('st', '12', 'f1')];
        unset($doc['objects'][0]['rev']);
        $imp = $this->importOk($s['gm'], $s['game'], self::scratchFile(json_encode($doc)), []);
        $nm = (string) ($imp['map']['id'] ?? $imp['id']);
        $uids = array_column($this->floorsOf($s['gm'], $nm), 'uid');
        self::assertSame(['f2', 'f1'], $uids, 'the numeric uid becomes the first free f<n>');
        $stairs = self::data($this->ok($s['gm']->get('/maps/' . $nm)))['objects'][0];
        self::assertSame('f1', $stairs['props']['to_floor']);
    }

    public function testDuplicateKeepsFloorsObjectsAndLinks(): void
    {
        $s = $this->built();
        $copy = self::data($this->ok($s['gm']->post('/maps/' . $s['a']['id'] . '/duplicate', ['name' => 'Copie']), 201));
        $cm = (string) $copy['id'];
        self::assertSame(['cave', 'f1', 'up'], array_column($copy['floors'], 'uid'));
        $objects = array_column($copy['objects'], null, 'uid');
        self::assertEquals((int) $s['a']['id'], $objects['st']['props']['link']['map_id'], 'links kept as they are');
        $out = array_column(self::data($this->ok($s['gm']->get('/maps/' . $cm . '/links')))['outgoing'], 'object_uid');
        sort($out);
        self::assertSame(['po', 'st'], $out);
        self::assertSame($objects['wc']['floor'], $this->floorId($cm, 'cave'));
    }

    public function testRestoreAfterFloorAddAndRemove(): void
    {
        $s = $this->built();
        $gm = $s['gm'];
        $m = (string) $s['a']['id'];
        $v = self::data($this->ok($gm->post('/maps/' . $m . '/versions', ['label' => 'avant']), 201));
        // Remove "up", add "attic", then restore.
        $this->opsOk($gm, $m, [['type' => 'floor.remove', 'uid' => 'up'], self::floorAdd('attic', 'Grenier', 3)]);
        self::assertSame(['cave', 'f1', 'attic'], array_column($this->floorsOf($gm, $m), 'uid'));
        $this->ok($gm->post('/maps/' . $m . '/versions/' . $v['id'] . '/restore', ['client_op_id' => 'r1']));
        self::assertSame(['cave', 'f1', 'up'], array_column($this->floorsOf($gm, $m), 'uid'));
        $objects = array_column(self::data($this->ok($gm->get('/maps/' . $m)))['objects'], null, 'uid');
        self::assertSame($this->floorId($m, 'up'), $objects['po']['floor']);
        self::assertEqualsCanonicalizing(['po', 'st', 'wc'], array_keys($objects));
        self::assertSame(3, $this->rows('map_floors', '`map_id` = ?', [(int) $m]));
        self::assertSame(2, $this->rows('map_links', '`from_map_id` = ?', [(int) $m]));
        // And restoring a snapshot that has fewer floors removes the extra ones.
        $v2 = self::data($this->ok($gm->post('/maps/' . $m . '/versions', ['label' => 'avant-2']), 201));
        $this->opsOk($gm, $m, [self::floorAdd('attic', 'Grenier', 3)]);
        $this->ok($gm->post('/maps/' . $m . '/versions/' . $v2['id'] . '/restore', ['client_op_id' => 'r2']));
        self::assertSame(['cave', 'f1', 'up'], array_column($this->floorsOf($gm, $m), 'uid'));
    }
}
