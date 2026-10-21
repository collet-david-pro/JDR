<?php

declare(strict_types=1);

namespace JDR\Tests\Games;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Assets\AssetsTestCase;

/**
 * API tests of games, members, tokens and encounters (contract P3).
 */
abstract class GamesTestCase extends AssetsTestCase
{
    private int $ipCounter = 10;

    /**
     * Logged-in client of a new user, each on its own IP (login rate limit).
     */
    protected function user(string $username, string $role = 'user'): ApiClient
    {
        $this->ipCounter++;

        return $this->userClient($username, $role, '198.51.100.' . $this->ipCounter);
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed> Game
     */
    protected function newGame(ApiClient $gm, string $name = 'Campagne', array $body = []): array
    {
        $response = $gm->post('/games', ['name' => $name] + $body);
        self::assertSame(201, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * Adds $username to the game (by username; the account is created if needed) and returns
     * the Member.
     *
     * @return array<string, mixed>
     */
    protected function addMember(ApiClient $gm, string $gameId, string $username, string $role = 'player'): array
    {
        if ($this->userId($username) === 0) {
            $this->createUser($username);
        }
        $response = $gm->post('/games/' . $gameId . '/members', ['identifier' => $username, 'role' => $role]);
        self::assertSame(201, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed> Token
     */
    protected function newToken(ApiClient $editor, string $gameId, array $body = []): array
    {
        $response = $editor->post('/games/' . $gameId . '/tokens', $body + ['name' => 'Gobelin', 'kind' => 'monster']);
        self::assertSame(201, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * @param array<string, string> $expected field => code
     */
    protected static function assertFieldErrors(Response $response, array $expected): void
    {
        self::assertSame(422, $response->status(), $response->body());
        self::assertSame('validation_failed', self::errorCode($response));
        $fields = $response->payload()['error']['fields'];
        foreach ($expected as $field => $code) {
            self::assertSame($code, $fields[$field] ?? null, $field . ' in ' . $response->body());
        }
    }

    /**
     * Ages the soft deletion of a row by $days.
     */
    protected function ageDeletion(string $table, string $id, int $days): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t($table) . ' SET `deleted_at` = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE `id` = ?',
            [$days, (int) $id],
        );
    }
}
