<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Games\GamePresenter;
use JDR\Domain\Games\GameService;

/**
 * /games (contract P3): list, create, show, update, trash, archive, restore.
 */
final class GamesController
{
    public function __construct(
        private GameService $games,
        private GamePolicy $policy,
        private GamePresenter $presenter,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /games?role=gm|player&state=active|archived|trash -> Game[]
     */
    public function index(Request $request): Response
    {
        $user = CurrentUser::require($request);

        return Response::ok($this->presenter->games($this->games->list($user, $request->query), $this->apiBase($request)));
    }

    /**
     * POST /games {name, description?, settings?} -> 201 Game
     */
    public function create(Request $request): Response
    {
        $game = $this->games->create(CurrentUser::require($request), self::body($request));

        return Response::ok($this->presenter->game($game, $this->apiBase($request)), [], 201);
    }

    /**
     * GET /games/{id} (member; the GM also sees a game in the trash)
     */
    public function show(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $game = $this->policy->requireView($user, self::id($request), true);

        return Response::ok($this->presenter->game($game, $this->apiBase($request)));
    }

    /**
     * PATCH /games/{id} {name?, description?, cover_asset_id?, settings?} (GM)
     */
    public function update(Request $request): Response
    {
        $game = $this->games->update(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::ok($this->presenter->game($game, $this->apiBase($request)));
    }

    /**
     * DELETE /games/{id} (GM) -> 204, soft delete
     */
    public function delete(Request $request): Response
    {
        $this->games->delete(CurrentUser::require($request), self::id($request));

        return Response::noContent();
    }

    /**
     * POST /games/{id}/archive (GM) -> Game
     */
    public function archive(Request $request): Response
    {
        $game = $this->games->archive(CurrentUser::require($request), self::id($request));

        return Response::ok($this->presenter->game($game, $this->apiBase($request)));
    }

    /**
     * POST /games/{id}/restore (GM) -> Game
     */
    public function restore(Request $request): Response
    {
        $game = $this->games->restore(CurrentUser::require($request), self::id($request));

        return Response::ok($this->presenter->game($game, $this->apiBase($request)));
    }

    private function apiBase(Request $request): string
    {
        return Input::apiBase($request, $this->config);
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
