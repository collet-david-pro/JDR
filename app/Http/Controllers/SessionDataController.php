<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Games\Fields;
use JDR\Domain\Sessions\PreloadService;
use JDR\Domain\Sessions\PresenceService;
use JDR\Domain\Sessions\SnapshotService;

/**
 * What a client downloads to follow a session (contract P6): GET /sessions/{id}/preload and
 * /snapshot, and the presence heartbeat POST /presence {session_id}. A player gets the filtered
 * view (fog_strict, PlayerFilter), 409 session_paused in pause (D5).
 */
final class SessionDataController
{
    public function __construct(
        private PreloadService $preload,
        private SnapshotService $snapshot,
        private PresenceService $presence,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /sessions/{id}/preload -> {map_id, floor_id, assets: [{id, url, bytes, kind}], total_bytes}
     */
    public function preload(Request $request): Response
    {
        return Response::ok($this->preload->preload(CurrentUser::require($request), (int) $request->param('id'), $this->apiBase($request)));
    }

    /**
     * GET /sessions/{id}/snapshot -> {session, map, tokens, fog, revealed, last_event_id}
     */
    public function snapshot(Request $request): Response
    {
        return Response::ok($this->snapshot->snapshot(CurrentUser::require($request), (int) $request->param('id'), $this->apiBase($request)));
    }

    /**
     * POST /presence {session_id} -> 204
     */
    public function presence(Request $request): Response
    {
        $body = $request->parsedBody();
        $body = is_array($body) ? $body : [];
        $sessionId = Fields::id($body['session_id'] ?? null)
            ?? throw new ValidationException('', ['session_id' => isset($body['session_id']) ? 'invalid' : 'required']);
        $this->presence->heartbeat(CurrentUser::require($request), $sessionId);

        return Response::noContent();
    }

    private function apiBase(Request $request): string
    {
        return Input::apiBase($request, $this->config);
    }
}
