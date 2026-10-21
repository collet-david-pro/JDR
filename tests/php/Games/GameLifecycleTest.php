<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

use JDR\Core\Cron;
use JDR\Domain\Games\GameHousekeeping;

/**
 * Account deletion (projet.md 11.1), personal data export, trash purge (cron "games_trash").
 */
final class GameLifecycleTest extends GamesTestCase
{
    public function testAccountDeletionTransfersToTheOldestCoGmOrTrashes(): void
    {
        $alice = $this->user('Alice');
        $shared = $this->newGame($alice, 'Avec co-MJ');
        $alone = $this->newGame($alice, 'Sans co-MJ');
        $this->addMember($alice, $shared['id'], 'Carol', 'co_gm');
        $this->db->execute('UPDATE ' . $this->db->t('game_members') . ' SET `joined_at` = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)');
        $this->addMember($alice, $shared['id'], 'Dave', 'co_gm');
        $this->addMember($alice, $shared['id'], 'Bob');
        $this->addMember($alice, $alone['id'], 'Bob');
        // Alice also plays in Bob's game, and owns a token there.
        $bob = $this->client('198.51.100.160');
        $bob->login('Bob', self::PASSWORD);
        $bobGame = $this->newGame($bob, 'Chez Bob');
        $aliceMember = $this->addMember($bob, $bobGame['id'], 'Alice');
        $owned = $this->newToken($bob, $bobGame['id'], ['kind' => 'pc', 'default_owner_user_id' => $aliceMember['user']['id']]);
        $aliceId = $this->userId('Alice');

        self::assertSame(204, $alice->delete('/me', ['password' => self::PASSWORD])->status());

        $carol = $this->client('198.51.100.161');
        $carol->login('Carol', self::PASSWORD);
        $transferred = self::data($carol->get('/games/' . $shared['id']));
        self::assertSame('gm', $transferred['my_role']);
        self::assertSame('Carol', $transferred['gm']['username']);
        self::assertSame(
            ['gm', 'co_gm', 'player'],
            array_column(self::data($carol->get('/games/' . $shared['id'] . '/members')), 'role'),
        );
        self::assertSame(['Carol', 'Dave', 'Bob'], array_column(array_column(self::data($carol->get('/games/' . $shared['id'] . '/members')), 'user'), 'username'));

        self::assertNotNull($this->db->fetchValue('SELECT `deleted_at` FROM ' . $this->db->t('games') . ' WHERE `id` = ?', [(int) $alone['id']]));
        self::assertSame(404, $bob->get('/games/' . $alone['id'])->status());

        self::assertSame(0, $this->rows('game_members', '`user_id` = ?', [$aliceId]));
        self::assertSame(['gm'], array_column(self::data($bob->get('/games/' . $bobGame['id'] . '/members')), 'role'));
        self::assertNull(self::data($bob->get('/tokens/' . $owned['id']))['default_owner_user_id']);

        $actions = $this->db->fetchAll('SELECT `action`, `entity`, `entity_id`, `user_id` FROM ' . $this->db->t('audit_log') . " WHERE `entity` = 'game' ORDER BY `id`");
        self::assertSame([
            ['action' => 'game.transfer', 'entity' => 'game', 'entity_id' => (int) $shared['id'], 'user_id' => null],
            ['action' => 'game.trash', 'entity' => 'game', 'entity_id' => (int) $alone['id'], 'user_id' => null],
        ], array_map(static fn (array $r): array => [
            'action' => $r['action'],
            'entity' => $r['entity'],
            'entity_id' => (int) $r['entity_id'],
            'user_id' => $r['user_id'],
        ], $actions));
    }

    public function testExportContainsGamesAndMemberships(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice, 'Ma campagne', ['description' => 'Desc']);
        $this->newToken($alice, $game['id'], ['name' => 'Golem']);
        $alice->post('/games/' . $game['id'] . '/encounters', ['name' => 'Salle 1']);
        $this->addMember($alice, $game['id'], 'Bob');
        $bob = $this->client('198.51.100.170');
        $bob->login('Bob', self::PASSWORD);
        $bobGame = $this->newGame($bob, 'Chez Bob');
        $this->addMember($bob, $bobGame['id'], 'Alice', 'co_gm');

        $export = $alice->get('/me/export');
        self::assertSame(200, $export->status());
        $games = $export->payload()['games'];
        self::assertSame('Ma campagne', $games['run'][0]['name']);
        self::assertSame('Desc', $games['run'][0]['description']);
        self::assertSame(['Golem'], array_column($games['run'][0]['tokens'], 'name'));
        self::assertSame(['Salle 1'], array_column($games['run'][0]['encounters'], 'name'));
        self::assertSame(['Bob'], array_column($games['run'][0]['members'], 'username'));
        self::assertSame($game['id'], $games['run'][0]['id']);
        self::assertSame([['game_id' => $bobGame['id'], 'name' => 'Chez Bob', 'role' => 'co_gm']], array_map(
            static fn (array $m): array => ['game_id' => $m['game_id'], 'name' => $m['name'], 'role' => $m['role']],
            $games['memberships'],
        ));
    }

    public function testTrashIsPurgedAfterTrashDays(): void
    {
        $alice = $this->user('Alice');
        $old = $this->newGame($alice, 'Ancienne');
        $recent = $this->newGame($alice, 'Récente');
        $live = $this->newGame($alice, 'Vivante');
        $this->addMember($alice, $old['id'], 'Bob');
        $token = $this->newToken($alice, $old['id']);
        $alice->post('/games/' . $old['id'] . '/encounters', ['name' => 'E', 'tokens' => [['token_id' => $token['id'], 'dx' => 0, 'dy' => 0]]]);
        $deadToken = $this->newToken($alice, $live['id'], ['name' => 'Supprimé']);
        $keptToken = $this->newToken($alice, $live['id'], ['name' => 'Supprimé récemment']);
        $alice->delete('/tokens/' . $deadToken['id']);
        $alice->delete('/tokens/' . $keptToken['id']);
        $alice->delete('/games/' . $old['id']);
        $alice->delete('/games/' . $recent['id']);
        $this->ageDeletion('games', $old['id'], 31);
        $this->ageDeletion('games', $recent['id'], 29);
        $this->ageDeletion('tokens', $deadToken['id'], 31);

        $purged = $this->app->container()->get(GameHousekeeping::class)->purgeTrash();
        self::assertSame(2, $purged); // one game + one token
        self::assertSame(['Récente', 'Vivante'], array_column($this->db->fetchAll('SELECT `name` FROM ' . $this->db->t('games') . ' ORDER BY `id`'), 'name'));
        self::assertSame(0, $this->rows('game_members'));
        self::assertSame(0, $this->rows('encounters'));
        self::assertSame(0, $this->rows('encounter_tokens'));
        self::assertSame(['Supprimé récemment'], array_column($this->db->fetchAll('SELECT `name` FROM ' . $this->db->t('tokens')), 'name'));
        self::assertSame(['Récente'], array_column(self::data($alice->get('/games?state=trash')), 'name'));

        // Registered as a cron task.
        $this->ageDeletion('games', $recent['id'], 40);
        self::assertContains('games_trash', $this->app->container()->get(Cron::class)->runTasks(5.0));
        self::assertSame(['Vivante'], array_column($this->db->fetchAll('SELECT `name` FROM ' . $this->db->t('games')), 'name'));
    }
}
