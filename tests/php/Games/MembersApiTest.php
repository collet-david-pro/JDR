<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

/**
 * /games/{id}/members: direct invitation, roles, removal, leaving.
 */
final class MembersApiTest extends GamesTestCase
{
    public function testInviteByUsernameOrEmail(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $this->createUser('Bob');
        $this->createUser('Carol');
        $this->createUser('Susan', 'user', self::PASSWORD, 'suspended');
        $path = '/games/' . $game['id'] . '/members';

        $bob = self::data($alice->post($path, ['identifier' => 'bob']));
        self::assertSame(['id' => (string) $this->userId('Bob'), 'username' => 'Bob'], $bob['user']);
        self::assertSame('player', $bob['role']);
        self::assertMatchesRegularExpression('/Z$/', $bob['joined_at']);
        $carol = $alice->post($path, ['identifier' => 'CAROL@example.org', 'role' => 'co_gm']);
        self::assertSame(201, $carol->status());
        self::assertSame('co_gm', self::data($carol)['role']);

        // Unknown e-mail, unknown username, suspended account: the same answer.
        $unknownEmail = $alice->post($path, ['identifier' => 'nobody@example.org']);
        $unknownName = $alice->post($path, ['identifier' => 'Nobody']);
        $suspended = $alice->post($path, ['identifier' => 'susan@example.org']);
        foreach ([$unknownEmail, $unknownName, $suspended] as $response) {
            self::assertFieldErrors($response, ['identifier' => 'not_found']);
        }
        self::assertSame($unknownEmail->payload()['error'], $suspended->payload()['error']);
        self::assertFieldErrors($alice->post($path, ['identifier' => 'Bob']), ['identifier' => 'already_member']);
        self::assertFieldErrors($alice->post($path, ['identifier' => 'Alice']), ['identifier' => 'already_member']);
        self::assertFieldErrors($alice->post($path, []), ['identifier' => 'required']);
        self::assertFieldErrors($alice->post($path, ['identifier' => 'Bob', 'role' => 'gm']), ['role' => 'invalid']);

        $members = self::data($alice->get($path));
        self::assertSame(['Alice', 'Bob', 'Carol'], array_column(array_column($members, 'user'), 'username'));
        self::assertSame(['gm', 'player', 'co_gm'], array_column($members, 'role'));
        self::assertSame(3, self::data($alice->get('/games/' . $game['id']))['counts']['members']);
    }

    public function testRolesRemovalAndLeaving(): void
    {
        $alice = $this->user('Alice');
        $game = $this->newGame($alice);
        $base = '/games/' . $game['id'] . '/members/';
        $bobId = $this->addMember($alice, $game['id'], 'Bob')['user']['id'];
        $carolId = $this->addMember($alice, $game['id'], 'Carol')['user']['id'];
        $aliceId = (string) $this->userId('Alice');

        $promoted = self::data($alice->patch($base . $bobId, ['role' => 'co_gm']));
        self::assertSame('co_gm', $promoted['role']);
        self::assertFieldErrors($alice->patch($base . $bobId, ['role' => 'admin']), ['role' => 'invalid']);
        self::assertFieldErrors($alice->patch($base . $bobId, []), ['role' => 'required']);
        self::assertSame(404, $alice->patch($base . '999999', ['role' => 'player'])->status());
        self::assertSame(403, $alice->patch($base . $aliceId, ['role' => 'player'])->status());
        // The GM never leaves their game.
        self::assertSame(403, $alice->delete($base . $aliceId)->status());

        // Carol owns a token; she leaves: the token has no owner any more.
        $token = $this->newToken($alice, $game['id'], ['kind' => 'pc', 'default_owner_user_id' => $carolId]);
        $carol = $this->client('198.51.100.120');
        $carol->login('Carol', self::PASSWORD);
        self::assertSame([$token['id']], array_column(self::data($carol->get('/games/' . $game['id'] . '/tokens')), 'id'));
        self::assertSame(403, $carol->delete($base . $bobId)->status());
        self::assertSame(204, $carol->delete($base . $carolId)->status());
        self::assertSame(404, $carol->get('/games/' . $game['id'])->status());
        self::assertSame([], self::data($carol->get('/games')));
        self::assertNull(self::data($alice->get('/tokens/' . $token['id']))['default_owner_user_id']);

        // The GM removes Bob.
        self::assertSame(204, $alice->delete($base . $bobId)->status());
        self::assertSame(404, $alice->delete($base . $bobId)->status());
        self::assertSame(['gm'], array_column(self::data($alice->get('/games/' . $game['id'] . '/members')), 'role'));
        self::assertSame(0, $this->rows('game_members'));
    }
}
