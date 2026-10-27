<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\NotFoundException;
use JDR\Domain\Displays\Display;
use JDR\Domain\Users\User;

/**
 * D11 (etapes P06): GET /maps/{id}/chunks and GET /maps/{id}/fog also accept a player of a
 * running session whose current map is {id}, filtered by fog_strict. Everything else on maps
 * stays GM / co-GM only (MapPolicy). P7b D7: a projection screen reads them for the current map of
 * its session, with the table scope (TableView).
 */
final class PlayerMapAccess
{
    public function __construct(
        private SessionSceneQueries $queries,
        private SessionAccess $access,
        private FogStrictScope $scopes,
        private TableView $table,
    ) {
    }

    /**
     * The scope of $user on the map as a player, or null when he is not a player of a session
     * playing it (the caller then keeps the MapPolicy refusal). 409 session_paused while the
     * session is paused (D5).
     *
     * @throws ConflictException session_paused
     */
    public function scopeFor(User $user, int $mapId): ?FogScope
    {
        $sessionId = $this->queries->playerSessionForMap($user->id, $mapId);
        if ($sessionId === null) {
            return null;
        }
        $ctx = $this->access->resolve($user, $sessionId);
        if ($ctx->isGm()) {
            return null;
        }
        if ($ctx->session->state === Session::PAUSED) {
            throw new ConflictException('', ['state' => Session::PAUSED], 'session_paused');
        }
        if ($ctx->session->state !== Session::RUNNING) {
            return null;
        }

        return $this->scopes->forUser($ctx, $user->id, $mapId);
    }

    /**
     * The table scope of a projection screen on the map: 404 when the map is not the current map
     * of its session or the session is not running; 409 session_paused while paused.
     *
     * @throws NotFoundException|ConflictException
     */
    public function scopeForDisplay(Display $display, int $mapId): FogScope
    {
        $ctx = $this->access->resolveDisplay($display, $display->sessionId);
        if ($ctx->session->currentMapId !== $mapId) {
            throw new NotFoundException();
        }
        if ($ctx->session->state === Session::PAUSED) {
            throw new ConflictException('', ['state' => Session::PAUSED], 'session_paused');
        }
        if ($ctx->session->state !== Session::RUNNING) {
            throw new NotFoundException();
        }

        return $this->table->scope($ctx, $mapId);
    }
}
