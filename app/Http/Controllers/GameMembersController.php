<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Games\GamePresenter;
use JDR\Domain\Games\GameService;

/**
 * /games/{id}/members (contract P3): list (member), direct invitation, role, removal / leaving.
 */
final class GameMembersController
{
    public function __construct(private GameService $games)
    {
    }

    /**
     * GET /games/{id}/members -> Member[] (the GM first, role "gm")
     */
    public function index(Request $request): Response
    {
        [$game, $members] = $this->games->members(CurrentUser::require($request), (int) $request->param('id'));

        return Response::ok(GamePresenter::members($game, $members));
    }

    /**
     * POST /games/{id}/members {identifier, role?} (GM) -> 201 Member
     */
    public function create(Request $request): Response
    {
        $member = $this->games->addMember(CurrentUser::require($request), (int) $request->param('id'), self::body($request));

        return Response::ok(GamePresenter::member($member), [], 201);
    }

    /**
     * PATCH /games/{id}/members/{userId} {role} (GM) -> Member
     */
    public function update(Request $request): Response
    {
        $member = $this->games->setMemberRole(
            CurrentUser::require($request),
            (int) $request->param('id'),
            (int) $request->param('userId'),
            self::body($request),
        );

        return Response::ok(GamePresenter::member($member));
    }

    /**
     * DELETE /games/{id}/members/{userId} (GM, or the member to leave) -> 204
     */
    public function delete(Request $request): Response
    {
        $this->games->removeMember(CurrentUser::require($request), (int) $request->param('id'), (int) $request->param('userId'));

        return Response::noContent();
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
