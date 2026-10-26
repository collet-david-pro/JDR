<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Realtime\EventStore;

/**
 * Writes the map-content events of a session (etapes P06 D3, D4, D5), always through
 * EventStore::record in the transaction of the change:
 * - D4: one complete event for the audience "gm" (payload.view = "gm") and the player version,
 *   made by PlayerFilter / PlayerView (payload.view = "player"): audience "players" when every
 *   player sees the same thing (fog_strict off), else one "user" event per concerned player
 *   (fog_strict scope, players_see_other_pcs). Nothing hidden (layer gm, visibility gm /
 *   hidden_until_revealed not revealed, secret door not revealed, hidden token, block outside the
 *   scope) is ever in a non-gm event. A GM reads every audience: his client ignores the events
 *   whose payload.view is "player";
 * - D5: while the session is paused, only "gm" events are written for the map content;
 * - D3: maptoken.moved and camera.moved are merged: the new event is inserted and the previous
 *   one of the same key (channel, type, audience, user, uid), less than one second old, is
 *   deleted in the same transaction. An inserted event is never edited (a reader may have read
 *   it); the deletion and the insertion become visible together at COMMIT, after the event_seq
 *   lock of D1, so "id > since" stays safe. The previous event is found by a non-locking read and
 *   deleted by primary key (record locks only: no gap lock that would block the INSERT of a
 *   concurrent writer holding event_seq).
 * The per-request logic is FanoutBatch (begin()).
 */
final class EventFanout
{
    public const VIEW_GM = 'gm';
    public const VIEW_PLAYER = 'player';
    /** D3: window of the merge, in seconds. */
    public const MERGE_WINDOW = 1;
    private const MERGE_SCAN = 50;

    public function __construct(
        private EventStore $store,
        private Db $db,
        private Clock $clock,
        private FogStrictScope $scopes,
        private PlayerView $view,
        private SessionRepository $sessions,
        private MapSceneRepository $scene,
    ) {
    }

    /**
     * State of the fan-out for one request (call inside the transaction, before the changes:
     * the fog_strict scopes of the players are read at once).
     */
    public function begin(SessionContext $ctx, Map $map, ?int $actor, ?string $opId): FanoutBatch
    {
        $players = [];
        foreach ($this->sessions->playersOf([$ctx->session->id])[$ctx->session->id] ?? [] as $p) {
            if ($p['status'] !== 'kicked') {
                $players[] = $p['user_id'];
            }
        }
        $assignments = [];
        foreach ($this->sessions->assignmentsOf([$ctx->session->id])[$ctx->session->id] ?? [] as $a) {
            $assignments[$a['token_id']] = $a['user_id'];
        }

        $hidden = array_column($this->db->fetchAll(
            'SELECT `uid` FROM ' . $this->db->t('map_tokens') . ' WHERE `map_id` = ? AND `hidden` = 1',
            [$map->id],
        ), 'uid');
        $sight = new PlayerSight(
            $this->view,
            $ctx,
            $map,
            $assignments,
            array_fill_keys($this->scene->revealedUids($map->id), true),
            array_fill_keys(array_map('strval', $hidden), true),
        );

        return new FanoutBatch($this, $this->scopes, $sight, $this->scene, $ctx, $map, $players, $actor, $opId);
    }

    /**
     * EventStore::record with the D3 merge of maptoken.moved / camera.moved.
     *
     * @param array<string, mixed> $payload
     */
    public function record(
        string $channel,
        string $type,
        string $audience,
        array $payload,
        ?int $audienceUserId,
        ?int $actorId,
        ?string $clientOpId,
        bool $ephemeral = false,
    ): void {
        if (in_array($type, EventTypes::MERGED, true)) {
            $this->mergePrevious($channel, $type, $audience, $audienceUserId, isset($payload['uid']) ? (string) $payload['uid'] : null);
        }
        $this->store->record($channel, $type, $audience, $payload, $audienceUserId, $actorId, $clientOpId, $ephemeral);
    }

    /**
     * D3: deletes the previous committed event of the same key, less than MERGE_WINDOW old.
     */
    private function mergePrevious(string $channel, string $type, string $audience, ?int $userId, ?string $uid): void
    {
        $since = $this->clock->now()->modify('-' . self::MERGE_WINDOW . ' second')->format('Y-m-d H:i:s');
        $rows = $this->db->fetchAll(
            'SELECT `id`, `payload` FROM ' . $this->db->t('events') . ' WHERE `created_at` >= ? AND `channel` = ? AND `type` = ? '
            . 'AND `audience` = ? AND ' . ($userId === null ? '`audience_user_id` IS NULL' : '`audience_user_id` = ?')
            . ' ORDER BY `id` DESC LIMIT ' . self::MERGE_SCAN,
            $userId === null ? [$since, $channel, $type, $audience] : [$since, $channel, $type, $audience, $userId],
        );
        $ids = [];
        foreach ($rows as $row) {
            $payload = json_decode((string) $row['payload'], true);
            $previous = is_array($payload) && isset($payload['uid']) ? (string) $payload['uid'] : null;
            if ($previous === $uid) {
                $ids[] = (int) $row['id'];
            }
        }
        if ($ids !== []) {
            $this->db->execute(
                'DELETE FROM ' . $this->db->t('events') . ' WHERE `id` IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')',
                $ids,
            );
        }
    }
}
