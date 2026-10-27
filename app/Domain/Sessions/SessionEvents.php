<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Realtime\Audience;
use JDR\Realtime\Channel;
use JDR\Realtime\EventStore;

/**
 * The session events of the catalogue (contract P6, rows "b"), written through EventStore::record
 * in the transaction of the change. Nothing hidden: every payload is public to its audience.
 */
final class SessionEvents
{
    public function __construct(private EventStore $store)
    {
    }

    /**
     * session.state (all): state, current map and floor, pause screen. pause_screen stays
     * {asset_id, text} without the signed URL (P7b D11): an event is stored and replayed while a
     * URL expires; a client that needs the image reads GET /sessions/{id} or GET /display/me.
     */
    public function state(Session $s, ?int $actor, ?string $opId): void
    {
        $this->record($s->id, 'session.state', Audience::ALL, [
            'state' => $s->state,
            'current_map_id' => $s->currentMapId,
            'floor_id' => $s->currentFloorId,
            'pause_screen' => $s->pauseScreen,
        ], null, $actor, $opId);
    }

    /** session.code (gm). */
    public function code(int $sessionId, string $code, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'session.code', Audience::GM, ['code' => $code], null, $actor, $opId);
    }

    /** player.joined (gm, players). */
    public function joined(int $sessionId, int $userId, string $username, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'player.joined', Audience::PLAYERS, ['user_id' => $userId, 'username' => $username], null, $actor, $opId);
    }

    /** player.left (gm, players). */
    public function left(int $sessionId, int $userId, string $username, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'player.left', Audience::PLAYERS, ['user_id' => $userId, 'username' => $username], null, $actor, $opId);
    }

    /** player.ready (gm, players). */
    public function ready(int $sessionId, int $userId, bool $ready, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'player.ready', Audience::PLAYERS, ['user_id' => $userId, 'ready' => $ready], null, $actor, $opId);
    }

    /** player.kicked (the kicked user only). */
    public function kicked(int $sessionId, int $userId, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'player.kicked', Audience::USER, ['reason' => null], $userId, $actor, $opId);
    }

    /** assignment.set (all): {token_id, user_id | null}. */
    public function assignment(int $sessionId, int $tokenId, ?int $userId, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'assignment.set', Audience::ALL, ['token_id' => $tokenId, 'user_id' => $userId], null, $actor, $opId);
    }

    /** map.changed (all). */
    public function mapChanged(int $sessionId, int $mapId, int $floorId, ?int $actor, ?string $opId): void
    {
        $this->record($sessionId, 'map.changed', Audience::ALL, ['map_id' => $mapId, 'floor_id' => $floorId], null, $actor, $opId);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function record(int $sessionId, string $type, string $audience, array $payload, ?int $audienceUser, ?int $actor, ?string $opId): void
    {
        $this->store->record(Channel::session($sessionId), $type, $audience, $payload, $audienceUser, $actor, $opId);
    }
}
