<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Encounters\Encounter;
use JDR\Domain\Encounters\EncounterService;

/**
 * Prepared encounters (contract P3): /games/{id}/encounters and /encounters/{id} (GM/co-GM).
 */
final class EncountersController
{
    public function __construct(private EncounterService $encounters)
    {
    }

    /**
     * GET /games/{id}/encounters -> Encounter[]
     */
    public function index(Request $request): Response
    {
        $list = $this->encounters->listFor(CurrentUser::require($request), (int) $request->param('id'));

        return Response::ok(array_map(static fn (Encounter $e): array => $e->toApi(), $list));
    }

    /**
     * POST /games/{id}/encounters {name, notes?, tokens?} -> 201 Encounter
     */
    public function create(Request $request): Response
    {
        $encounter = $this->encounters->create(CurrentUser::require($request), (int) $request->param('id'), self::body($request));

        return Response::ok($encounter->toApi(), [], 201);
    }

    /**
     * PATCH /encounters/{id} -> Encounter
     */
    public function update(Request $request): Response
    {
        $encounter = $this->encounters->update(CurrentUser::require($request), (int) $request->param('id'), self::body($request));

        return Response::ok($encounter->toApi());
    }

    /**
     * DELETE /encounters/{id} -> 204
     */
    public function delete(Request $request): Response
    {
        $this->encounters->delete(CurrentUser::require($request), (int) $request->param('id'));

        return Response::noContent();
    }

    /**
     * POST /encounters/{id}/place {map_id, floor_id, x, y}: P4 (404 until maps exist).
     */
    public function place(Request $request): Response
    {
        $this->encounters->place(CurrentUser::require($request), (int) $request->param('id'));
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
