<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9c;

use JDR\Tests\Api\ApiClient;
use JDR\Tests\MapsP9\MapsP9TestCase;

/**
 * Helpers of the map template tests (P9c1): a world with every role, a busy map, rows read back.
 */
abstract class TemplatesTestCase extends MapsP9TestCase
{
    /**
     * GM (Alice), co-GM (Carol), player (Bob), stranger (Eve), admin (Root), a game and a map.
     *
     * @return array{gm: ApiClient, co: ApiClient, bob: ApiClient, eve: ApiClient, admin: ApiClient, game: string, map: string, floor: string}
     */
    protected function tw(): array
    {
        $gm = $this->user('Alice');
        $game = (string) $this->newGame($gm)['id'];
        $this->addMember($gm, $game, 'Carol', 'co_gm');
        $this->addMember($gm, $game, 'Bob', 'player');
        $map = $this->newMap($gm, $game, ['name' => 'Cave']);

        return [
            'gm' => $gm,
            'co' => $this->login('Carol'),
            'bob' => $this->login('Bob'),
            'eve' => $this->user('Eve'),
            'admin' => $this->user('Root', 'admin'),
            'game' => $game,
            'map' => (string) $map['id'],
            'floor' => (string) $map['floors'][0]['id'],
        ];
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    protected function saveTpl(ApiClient $who, string $map, array $body, int $status = 201): array
    {
        $response = $who->post('/maps/' . $map . '/save-as-template', $body);
        self::assertSame($status, $response->status(), $response->body());

        return $status === 201 ? self::data($response) : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    protected function listTpl(ApiClient $who): array
    {
        $response = $who->get('/templates');
        self::assertSame(200, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed> the created Map
     */
    protected function instantiateTpl(ApiClient $who, string|int $template, string $game, array $body = [], int $status = 201): array
    {
        $response = $who->post('/templates/' . $template . '/instantiate', ['game_id' => (int) $game] + $body);
        self::assertSame($status, $response->status(), $response->body());

        return $status === 201 ? self::data($response) : [];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapRow(string|int $id): array
    {
        return $this->db->fetchOne('SELECT * FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $id]) ?? [];
    }

    /**
     * @return array<string, mixed>
     */
    protected function objectRow(string|int $map, string $uid): array
    {
        return $this->db->fetchOne('SELECT * FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `uid` = ?', [(int) $map, $uid]) ?? [];
    }

    protected function countRows(string $table, string|int $map): int
    {
        return $this->rows($table, '`map_id` = ?', [(int) $map]);
    }

    /**
     * Makes an uploaded asset a general-library one (no owner).
     */
    protected function makeGeneral(string|int $assetId): void
    {
        $this->db->execute('UPDATE ' . $this->db->t('assets') . ' SET `owner_user_id` = NULL WHERE `id` = ?', [(int) $assetId]);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    protected static function noteOp(string $uid, array $over = []): array
    {
        return ['type' => 'note.add', 'note' => array_replace(['uid' => $uid, 'title' => 'Titre ' . $uid, 'body' => 'Corps ' . $uid], $over)];
    }
}
