<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9c;

use JDR\Domain\Maps\MapUserData;
use JDR\Domain\Users\UserRepository;

/**
 * Account deletion and templates (P9c1, point 7): a `site` template survives its author when another
 * admin can take it over; a private template leaves with the account (FK CASCADE).
 */
final class TemplatesAccountTest extends TemplatesTestCase
{
    private function deleteAccount(string $username): void
    {
        $c = $this->app->container();
        $user = $c->get(UserRepository::class)->find($this->userId($username));
        self::assertNotNull($user);
        // As GameUserData does before: the games of the account are gone (purged).
        $this->db->execute('DELETE FROM ' . $this->db->t('games') . ' WHERE `gm_user_id` = ?', [$user->id]);
        $c->get(MapUserData::class)->deleteUserData($user);
        $this->db->execute('DELETE FROM ' . $this->db->t('users') . ' WHERE `id` = ?', [$user->id]);
    }

    public function testASiteTemplateSurvivesItsAuthorWhenAnotherAdminExists(): void
    {
        $w = $this->tw();
        $second = $this->user('Boss', 'admin');
        $map = (string) $this->newMap($second, (string) $this->newGame($second, 'Boss')['id'])['id'];
        $site = $this->saveTpl($second, $map, ['name' => 'Commun', 'scope' => 'site']);
        $private = $this->saveTpl($second, $map, ['name' => 'Privé']);

        $this->deleteAccount('Boss');

        self::assertSame($this->userId('Root'), (int) $this->mapRow($site['id'])['owner_user_id'], 'taken over by the other admin');
        self::assertSame([], $this->mapRow($private['id']), 'private template leaves with the account');
        self::assertContains('Commun', array_column($this->listTpl($w['gm']), 'name'));
    }

    public function testExportListsTemplatesOfTheUser(): void
    {
        $w = $this->tw();
        $t = $this->saveTpl($w['gm'], $w['map'], ['name' => 'Privé']);
        $c = $this->app->container();
        $export = $c->get(MapUserData::class)->export($c->get(UserRepository::class)->find($this->userId('Alice')));
        $mine = array_values(array_filter($export, static fn (array $m): bool => $m['id'] === (int) $t['id']));
        self::assertCount(1, $mine);
        self::assertNull($mine[0]['game_id']);
    }
}
