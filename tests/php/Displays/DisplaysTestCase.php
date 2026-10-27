<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\SessionsActions\ActionsTestCase;

/**
 * Tests of the projection screens (P7a): arena() of the sessions plus screen clients (an
 * ApiClient without login, which keeps the jdr_display cookie) and helpers. P7b: the session
 * actions helpers (ActionsTestCase) for the table view.
 */
abstract class DisplaysTestCase extends ActionsTestCase
{
    private int $screenIp = 0;

    /**
     * An anonymous browser with its CSRF token (GET /auth/me), one IP of its own (pairing is limited per IP).
     */
    protected function screen(): ApiClient
    {
        $client = $this->client('198.18.0.' . (++$this->screenIp));
        $this->ok($client->get('/auth/me'));

        return $client;
    }

    /**
     * @return array<string, mixed> the Display object, with its "pairing"
     */
    protected function makeDisplay(ApiClient $gm, string $sessionId, string $name = 'Table'): array
    {
        return self::data($this->ok($gm->post('/sessions/' . $sessionId . '/displays', ['name' => $name]), 201));
    }

    /**
     * A paired screen of the session: [client, Display object as the GM sees it after pairing].
     *
     * @return array{0: ApiClient, 1: array<string, mixed>}
     */
    protected function pairedScreen(ApiClient $gm, string $sessionId, string $name = 'Table'): array
    {
        $display = $this->makeDisplay($gm, $sessionId, $name);
        $screen = $this->screen();
        $this->ok($screen->post('/display/pair', ['code' => $display['pairing']['code']]));

        return [$screen, $display];
    }

    /**
     * @return array<string, mixed>|null row of session_displays
     */
    protected function displayRow(string $id): ?array
    {
        return $this->db->fetchOne('SELECT * FROM ' . $this->db->t('session_displays') . ' WHERE `id` = ?', [(int) $id]);
    }

    protected function setDisplay(string $id, string $column, mixed $value): void
    {
        $this->db->execute('UPDATE ' . $this->db->t('session_displays') . ' SET `' . $column . '` = ? WHERE `id` = ?', [$value, (int) $id]);
    }

    /**
     * GET of a signed URL given by the API (apiBase "/api/v1" in the tests).
     */
    protected function fetchUrl(ApiClient $client, string $url): Response
    {
        return $client->get((string) preg_replace('#^.*?/api/v1#', '', $url));
    }
}
