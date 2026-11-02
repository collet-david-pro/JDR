<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9c;

/**
 * What a template copy leaves behind and what it keeps (P9c1, points 1 to 6), both ways.
 */
final class TemplatesCopyTest extends TemplatesTestCase
{
    /**
     * A map that carries everything a table adds: token, fog, shared notes, revealed trap and secret,
     * links to another map and between floors.
     *
     * @return array<string, mixed> tw() + other, token, bobId
     */
    private function busy(): array
    {
        $w = $this->tw();
        $gm = $w['gm'];
        $other = (string) $this->newMap($gm, $w['game'], ['name' => 'Autre'])['id'];
        $token = $this->newToken($gm, $w['game']);
        $bobId = $this->userId('Bob');
        $link = ['map_id' => (int) $other, 'floor' => 'f1', 'x' => 2, 'y' => 2];
        $door = [
            'uid' => 'door1', 'floor' => 'f1', 'type' => 'door', 'layer' => 'walls', 'visibility' => 'all', 'locked' => false, 'sort_order' => 0, 'geometry' => ['a' => [1, 1], 'b' => [2, 1]],
            'props' => ['state' => 'closed', 'locked' => false, 'secret' => false, 'asset_open' => null, 'asset_closed' => null, 'swing' => 'a', 'link' => $link],
        ];
        $trap = ['uid' => 'trap1', 'floor' => 'f1', 'type' => 'trap', 'geometry' => ['x' => 7, 'y' => 7], 'props' => ['note' => 'n1', 'reveal_effect' => 'pulse']];
        $this->opsOk($gm, $w['map'], [
            self::floorAdd('up', 'Étage', 1),
            self::noteOp('n1', ['audience' => 'all', 'read_aloud' => true]),
            self::noteOp('n2', ['audience' => 'players', 'audience_users' => [$bobId]]),
            self::addObject(['uid' => 'pin1', 'floor' => 'f1', 'type' => 'pin', 'geometry' => ['x' => 6, 'y' => 6], 'props' => ['icon' => 'place', 'color' => '#ff0000', 'note' => 'n2']]),
            self::addObject($trap),
            self::addObject($door),
            self::addObject(self::stairs('s1', 'f1', 'up')),
            self::addObject(self::portal('p1', 'f1', $link)),
            self::addObject(self::portal('p2', 'f1', ['map_id' => (int) $w['map'], 'floor' => 'up', 'x' => 1, 'y' => 1])),
            self::addToken(self::placedToken('tok1', 'f1', (string) $token['id'], 3, 3)),
            self::fogReveal('f1'),
        ]);
        $this->db->execute('UPDATE ' . $this->db->t('map_objects') . ' SET `revealed_at` = UTC_TIMESTAMP() WHERE `map_id` = ? AND `uid` = ?', [(int) $w['map'], 'trap1']);

        return $w + ['other' => $other, 'token' => $token, 'bobId' => $bobId];
    }

    /**
     * Checks one copy (a template made from the busy map, or a map made from that template).
     */
    private function assertClean(string|int $copy): void
    {
        self::assertSame(0, $this->countRows('map_tokens', $copy), 'point 1: no placed token');
        self::assertSame(0, $this->countRows('map_fog', $copy), 'point 1: no fog');

        $notes = $this->db->fetchAll('SELECT `uid`, `title`, `audience`, `gm_only`, `read_aloud` FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ? ORDER BY `uid`', [(int) $copy]);
        self::assertSame(['n1', 'n2'], array_column($notes, 'uid'), 'point 2: notes kept');
        self::assertSame(['gm', 'gm'], array_column($notes, 'audience'));
        self::assertSame(['1', '1'], array_map('strval', array_column($notes, 'gm_only')));
        self::assertSame('Titre n1', $notes[0]['title']);
        self::assertSame(1, (int) $notes[0]['read_aloud'], 'the read-aloud flag is kept');
        $users = (int) $this->db->fetchValue(
            'SELECT COUNT(*) FROM ' . $this->db->t('map_note_users') . ' u JOIN ' . $this->db->t('map_notes') . ' n ON n.`id` = u.`note_id` WHERE n.`map_id` = ?',
            [(int) $copy],
        );
        self::assertSame(0, $users, 'point 2: no account in an audience');
        $pin = $this->db->fetchValue('SELECT n.`uid` FROM ' . $this->db->t('map_objects') . ' o JOIN ' . $this->db->t('map_notes') . ' n ON n.`id` = o.`note_id` WHERE o.`map_id` = ? AND o.`uid` = ?', [(int) $copy, 'pin1']);
        self::assertSame('n2', $pin, 'the pin is linked to the note of the copy');

        $trap = $this->objectRow($copy, 'trap1');
        self::assertNull($trap['revealed_at'], 'point 3: not revealed');
        self::assertSame('hidden_until_revealed', $trap['visibility'], 'point 3: original visibility');
    }

    public function testMapToTemplateToMapLeavesTheTableBehind(): void
    {
        $w = $this->busy();
        $source = $this->objectRow($w['map'], 'trap1');
        self::assertNotNull($source['revealed_at'], 'setup: revealed in the source');
        self::assertSame(1, $this->countRows('map_tokens', $w['map']));
        self::assertGreaterThan(0, $this->countRows('map_fog', $w['map']));

        $t = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Modèle occupé']);
        $this->assertClean($t['id']);
        self::assertSame(2, $t['floors']);
        self::assertSame(2, $t['notes']);
        self::assertSame(1, (int) $this->mapRow($t['id'])['is_template']);
        self::assertNull($this->mapRow($t['id'])['game_id']);
        self::assertNull($this->mapRow($t['id'])['thumb_asset_path'], 'point 6: no thumbnail');

        $map = $this->instantiateTpl($w['gm'], $t['id'], $w['game'], ['name' => 'Depuis le modèle']);
        $this->assertClean($map['id']);
        self::assertSame(0, (int) $this->mapRow($map['id'])['is_template']);
        self::assertNull($this->mapRow($map['id'])['thumb_asset_path']);
        self::assertSame(['f1', 'up'], array_column($map['floors'], 'uid'));
        // The source is untouched.
        self::assertSame(1, $this->countRows('map_tokens', $w['map']));
        self::assertSame('all', $this->db->fetchValue('SELECT `audience` FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $w['map'], 'n1']));
        self::assertNotNull($this->objectRow($w['map'], 'trap1')['revealed_at']);
    }

    public function testLinksToAnotherMapLeaveButFloorStairsStay(): void
    {
        $w = $this->busy();
        $t = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Liens']);
        foreach ([(int) $t['id'], (int) $this->instantiateTpl($w['gm'], $t['id'], $w['game'])['id']] as $copy) {
            $door = json_decode((string) $this->objectRow($copy, 'door1')['props'], true);
            self::assertArrayNotHasKey('link', $door, 'point 4: link to another map removed from the door');
            self::assertSame([], $this->objectRow($copy, 'p1'), 'point 4: a portal without target is dropped');
            $stairs = json_decode((string) $this->objectRow($copy, 's1')['props'], true);
            self::assertSame('up', $stairs['to_floor'], 'point 4: the stairs between floors stay');
            $self = json_decode((string) $this->objectRow($copy, 'p2')['props'], true);
            self::assertSame($copy, (int) $self['link']['map_id'], 'a link to its own map follows the copy');
            $rows = $this->db->fetchAll('SELECT `from_map_id`, `to_map_id` FROM ' . $this->db->t('map_links') . ' WHERE `from_map_id` = ?', [$copy]);
            self::assertSame([['from_map_id' => $copy, 'to_map_id' => $copy]], array_map(static fn (array $r): array => array_map('intval', $r), $rows), 'map_links rebuilt');
        }
        // The links of the source stay.
        $links = $this->db->fetchAll('SELECT `to_map_id` FROM ' . $this->db->t('map_links') . ' WHERE `from_map_id` = ? ORDER BY `to_map_id`', [(int) $w['map']]);
        self::assertSame([(int) $w['map'], (int) $w['other'], (int) $w['other']], array_map(static fn (array $r): int => (int) $r['to_map_id'], $links));
    }

    public function testSiteScopeRefusesPrivateAssets(): void
    {
        $w = $this->tw();
        $a = $this->uploadOk($w['admin'], 'valid_png_opaque.png', ['kind' => 'tile']);
        $game = (string) $this->newGame($w['admin'], 'Admin')['id'];
        $created = $this->newMap($w['admin'], $game);
        $map = (string) $created['id'];
        $this->opsOk($w['admin'], $map, [self::paletteAdd(1, (string) $a['id']), self::tiles((string) $created['floors'][0]['id'], 'ground', [[0, 0, 1], [1, 0, 1]])]);

        $response = $w['admin']->post('/maps/' . $map . '/save-as-template', ['name' => 'Site', 'scope' => 'site']);
        self::assertFieldErrors($response, ['scope' => 'private_assets']);
        self::assertSame(0, $this->rows('maps', "`is_template` = 1 AND `template_scope` = 'site' AND `owner_user_id` = ?", [$this->userId('Root')]));
        $private = $this->saveTpl($w['admin'], $map, ['name' => 'Privé', 'scope' => 'private']);
        self::assertGreaterThan(0, $this->countRows('map_asset_refs', $map));
        self::assertSame($this->countRows('map_asset_refs', $map), $this->countRows('map_asset_refs', $private['id']), 'copyRefs kept');

        $this->makeGeneral($a['id']);
        $site = $this->saveTpl($w['admin'], $map, ['name' => 'Site', 'scope' => 'site']);
        self::assertSame('site', $site['scope']);
        $palette = json_decode((string) $this->mapRow($site['id'])['palette'], true);
        self::assertSame((int) $a['id'], (int) $palette[1]['asset_id'], 'the palette is kept');
    }

    public function testSiteScopeRefusesAPrivateNoteImage(): void
    {
        $w = $this->tw();
        $img = $this->uploadOk($w['admin'], 'valid_png_opaque.png', ['kind' => 'object']);
        $map = (string) $this->newMap($w['admin'], (string) $this->newGame($w['admin'], 'Admin')['id'])['id'];
        $this->opsOk($w['admin'], $map, [self::noteOp('img', ['asset_id' => (int) $img['id']])]);

        self::assertFieldErrors($w['admin']->post('/maps/' . $map . '/save-as-template', ['name' => 'Site', 'scope' => 'site']), ['scope' => 'private_assets']);
        $private = $this->saveTpl($w['admin'], $map, ['name' => 'Privé']);
        self::assertSame((int) $img['id'], (int) $this->db->fetchValue('SELECT `asset_id` FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ?', [(int) $private['id']]), 'the image of the note is kept');
        $this->makeGeneral($img['id']);
        $this->saveTpl($w['admin'], $map, ['name' => 'Site', 'scope' => 'site']);
    }

    public function testDuplicateStillKeepsEverything(): void
    {
        $w = $this->busy();
        $copy = self::data($this->ok($w['gm']->post('/maps/' . $w['map'] . '/duplicate', []), 201));
        self::assertSame(1, $this->countRows('map_tokens', $copy['id']));
        self::assertGreaterThan(0, $this->countRows('map_fog', $copy['id']));
        self::assertNotNull($this->objectRow($copy['id'], 'trap1')['revealed_at']);
        self::assertSame('players', $this->db->fetchValue('SELECT `audience` FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $copy['id'], 'n2']));
    }
}
