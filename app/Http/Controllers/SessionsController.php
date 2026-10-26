<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Sessions\SessionPlayers;
use JDR\Domain\Sessions\SessionService;

/**
 * Sessions: life cycle and players (contract P6 "Endpoints séances"). Rights: SessionAccess /
 * GamePolicy (GM and co-GM for the writes; player 403; non-member 404). Every write accepts a
 * client_op_id in its JSON body.
 */
final class SessionsController
{
    public function __construct(private SessionService $sessions, private SessionPlayers $players)
    {
    }

    /**
     * POST /games/{id}/sessions {name?, map_id?, floor_id?} -> 201 Session (409 session_exists)
     */
    public function create(Request $request): Response
    {
        return Response::ok($this->sessions->create(CurrentUser::require($request), self::id($request), self::body($request)), [], 201);
    }

    /**
     * GET /games/{id}/sessions?cursor=&limit= -> Session[] (meta.next_cursor)
     */
    public function index(Request $request): Response
    {
        [$list, $next] = $this->sessions->list(CurrentUser::require($request), self::id($request), $request->query);

        return Response::ok($list, $next === null ? [] : ['next_cursor' => $next]);
    }

    /**
     * GET /sessions/{id} -> Session
     */
    public function show(Request $request): Response
    {
        return Response::ok($this->sessions->show(CurrentUser::require($request), self::id($request)));
    }

    /**
     * PATCH /sessions/{id} {name?, pause_screen?} (GM) -> Session
     */
    public function update(Request $request): Response
    {
        return Response::ok($this->sessions->update(CurrentUser::require($request), self::id($request), self::body($request)));
    }

    /**
     * POST /sessions/join {code} -> {session_id, game_id}
     */
    public function join(Request $request): Response
    {
        return Response::ok($this->players->join(CurrentUser::require($request), self::body($request)));
    }

    /**
     * POST /sessions/{id}/leave (player) -> 204
     */
    public function leave(Request $request): Response
    {
        $this->players->leave(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::noContent();
    }

    public function start(Request $request): Response
    {
        return $this->transition($request, 'start');
    }

    public function pause(Request $request): Response
    {
        return $this->transition($request, 'pause');
    }

    public function resume(Request $request): Response
    {
        return $this->transition($request, 'resume');
    }

    public function end(Request $request): Response
    {
        return $this->transition($request, 'end');
    }

    /**
     * POST /sessions/{id}/regenerate-code (GM) -> {code}
     */
    public function regenerateCode(Request $request): Response
    {
        return Response::ok($this->sessions->regenerateCode(CurrentUser::require($request), self::id($request), self::body($request)));
    }

    /**
     * POST /sessions/{id}/kick {user_id} (GM) -> 204
     */
    public function kick(Request $request): Response
    {
        $this->players->kick(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::noContent();
    }

    /**
     * PUT /sessions/{id}/assignments/{tokenId} {user_id | null} (GM) -> {token_id, user_id}
     */
    public function assign(Request $request): Response
    {
        $result = $this->players->assign(
            CurrentUser::require($request),
            self::id($request),
            (int) $request->param('tokenId'),
            self::body($request),
        );

        return Response::ok($result);
    }

    /**
     * POST /sessions/{id}/ready {ready} (player) -> 204
     */
    public function ready(Request $request): Response
    {
        $this->players->ready(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::noContent();
    }

    /**
     * POST /sessions/{id}/change-map {map_id, floor_id?} (GM) -> Session
     */
    public function changeMap(Request $request): Response
    {
        return Response::ok($this->sessions->changeMap(CurrentUser::require($request), self::id($request), self::body($request)));
    }

    private function transition(Request $request, string $action): Response
    {
        return Response::ok($this->sessions->transition(CurrentUser::require($request), self::id($request), $action, self::body($request)));
    }

    private static function id(Request $request): int
    {
        return (int) $request->param('id');
    }

    /**
     * @return array<array-key, mixed>
     */
    private static function body(Request $request): array
    {
        $body = $request->parsedBody();

        return is_array($body) ? $body : [];
    }
}
