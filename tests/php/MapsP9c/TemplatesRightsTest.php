<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9c;

/**
 * Rights and visibility of the four template routes (P9c1), and templates closed to the editor.
 */
final class TemplatesRightsTest extends TemplatesTestCase
{
    public function testListNeedsALogin(): void
    {
        self::assertSame(401, $this->client('198.51.100.200')->get('/templates')->status());
    }

    public function testSaveRightsByRole(): void
    {
        $w = $this->tw();
        $this->saveTpl($w['gm'], $w['map'], ['name' => 'Mon modèle']);
        $this->saveTpl($w['co'], $w['map'], ['name' => 'Du co-MJ']);
        $this->saveTpl($w['bob'], $w['map'], ['name' => 'x'], 403);
        $this->saveTpl($w['eve'], $w['map'], ['name' => 'x'], 404);
        $this->saveTpl($w['gm'], '999999', ['name' => 'x'], 404);
        self::assertSame(422, $w['gm']->post('/maps/' . $w['map'] . '/save-as-template', ['name' => ''])->status());
        self::assertSame(422, $w['gm']->post('/maps/' . $w['map'] . '/save-as-template', ['name' => 'a', 'scope' => 'game'])->status());
        self::assertSame(2, $this->rows('maps', "`is_template` = 1 AND `template_scope` = 'private'"));
    }

    public function testSiteScopeIsForAdmins(): void
    {
        $w = $this->tw();
        $this->saveTpl($w['gm'], $w['map'], ['name' => 'Pour tous', 'scope' => 'site'], 403);
        self::assertSame(0, $this->rows('maps', "`is_template` = 1 AND `template_scope` = 'private'"));
        $adminGame = (string) $this->newGame($w['admin'], 'Admin')['id'];
        $adminMap = (string) $this->newMap($w['admin'], $adminGame)['id'];
        $row = $this->saveTpl($w['admin'], $adminMap, ['name' => 'Pour tous', 'scope' => 'site']);
        self::assertSame('site', $row['scope']);
        self::assertTrue($row['can_delete']);
        self::assertTrue($row['owned']);
    }

    public function testVisibilityPrivateAndSite(): void
    {
        $w = $this->tw();
        $mine = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Privé']);
        $adminMap = (string) $this->newMap($w['admin'], (string) $this->newGame($w['admin'], 'Admin')['id'])['id'];
        $site = $this->saveTpl($w['admin'], $adminMap, ['name' => 'Commun', 'scope' => 'site']);

        $names = static fn (array $rows): array => array_column($rows, 'name');
        self::assertContains('Privé', $names($this->listTpl($w['gm'])));
        self::assertNotContains('Privé', $names($this->listTpl($w['eve'])), 'private: the owner only');
        self::assertNotContains('Privé', $names($this->listTpl($w['admin'])));
        foreach (['gm', 'eve', 'bob'] as $who) {
            self::assertContains('Commun', $names($this->listTpl($w[$who])));
        }
        $row = array_values(array_filter($this->listTpl($w['gm']), static fn (array $r): bool => $r['name'] === 'Commun'))[0];
        self::assertFalse($row['owned']);
        self::assertFalse($row['can_delete']);
        self::assertFalse($row['builtin']);
        self::assertSame(['id', 'name', 'scope', 'builtin', 'kind', 'width', 'height', 'floors', 'notes', 'owned', 'can_delete'], array_keys($row));
        self::assertSame(['width' => 60, 'height' => 40, 'floors' => 1, 'notes' => 0], ['width' => $row['width'], 'height' => $row['height'], 'floors' => $row['floors'], 'notes' => $row['notes']]);

        $eveGame = (string) $this->newGame($w['eve'], 'Eve')['id'];
        $this->instantiateTpl($w['eve'], $mine['id'], $eveGame, [], 404);
        $this->instantiateTpl($w['eve'], $site['id'], $eveGame);
    }

    public function testInstantiateRights(): void
    {
        $w = $this->tw();
        $t = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Modèle']);
        $created = $this->instantiateTpl($w['gm'], $t['id'], $w['game'], ['name' => 'Nouvelle']);
        self::assertSame('Nouvelle', $created['name']);
        self::assertSame((int) $w['game'], (int) $created['game_id']);
        $fromString = $w['gm']->post('/templates/' . $t['id'] . '/instantiate', ['game_id' => (string) $w['game']]);
        self::assertSame(201, $fromString->status(), 'the front sends identifiers as strings');
        self::assertSame(0, (int) $created['revision']);
        self::assertNotEmpty($created['floors']);
        $this->instantiateTpl($w['co'], $t['id'], $w['game'], [], 404);
        $own = $this->saveTpl($w['co'], $w['map'], ['name' => 'Du co-MJ']);
        $byCo = $this->instantiateTpl($w['co'], $own['id'], $w['game']);
        self::assertSame('Du co-MJ', $byCo['name'], 'name defaults to the template one');
        $this->instantiateTpl($w['bob'], $t['id'], $w['game'], [], 403);
        $this->instantiateTpl($w['eve'], $t['id'], $w['game'], [], 404);
        $this->instantiateTpl($w['gm'], 999999, $w['game'], [], 404);
        self::assertSame(422, $w['gm']->post('/templates/' . $t['id'] . '/instantiate', [])->status());
        self::assertSame(422, $w['gm']->post('/templates/' . $t['id'] . '/instantiate', ['game_id' => (int) $w['game'], 'name' => str_repeat('x', 500)])->status());
    }

    public function testDeleteRules(): void
    {
        $w = $this->tw();
        $mine = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Privé']);
        $adminMap = (string) $this->newMap($w['admin'], (string) $this->newGame($w['admin'], 'Admin')['id'])['id'];
        $site = $this->saveTpl($w['admin'], $adminMap, ['name' => 'Commun', 'scope' => 'site']);

        self::assertSame(404, $w['eve']->delete('/templates/' . $mine['id'])->status(), 'invisible');
        self::assertSame(404, $w['admin']->delete('/templates/' . $mine['id'])->status(), 'private of someone else, even for an admin');
        self::assertSame(403, $w['gm']->delete('/templates/' . $site['id'])->status(), 'visible but site');
        self::assertSame(404, $w['gm']->delete('/templates/999999')->status());
        self::assertSame(204, $w['gm']->delete('/templates/' . $mine['id'])->status());
        self::assertSame(204, $w['admin']->delete('/templates/' . $site['id'])->status());
        self::assertSame(0, $this->rows('maps', '`is_template` = 1 AND `id` IN (?, ?)', [(int) $mine['id'], (int) $site['id']]));
        self::assertSame(1, $this->rows('maps', '`game_id` = ?', [(int) $w['game']]), 'the game map stays');
    }

    public function testATemplateIsClosedToTheEditorAndTheMapList(): void
    {
        $w = $this->tw();
        $t = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Modèle']);
        $id = (string) $t['id'];
        self::assertSame(404, $w['gm']->get('/maps/' . $id)->status());
        self::assertSame(404, $this->sendOps($w['gm'], $id, [], 0)->status());
        self::assertSame(404, $w['gm']->post('/maps/' . $id . '/duplicate', [])->status());
        self::assertSame(404, $w['gm']->post('/maps/' . $id . '/save-as-template', ['name' => 'x'])->status());
        self::assertSame(404, $w['gm']->get('/maps/' . $id . '/chunks')->status());
        $list = self::data($this->ok($w['gm']->get('/games/' . $w['game'] . '/maps')));
        self::assertSame([(int) $w['map']], array_map('intval', array_column($list, 'id')));
    }
}
