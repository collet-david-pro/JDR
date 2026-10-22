<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Maps\MapOpsService;
use JDR\Domain\Maps\MapPresenter;
use JDR\Domain\Maps\MapService;

/**
 * Maps (contract P4b): /games/{id}/maps and /maps/{id}[/restore|/duplicate|/ops|/chunks].
 * Rights: MapPolicy (GM / co-GM; player 403; others 404).
 */
final class MapsController
{
    public function __construct(
        private MapService $maps,
        private MapOpsService $ops,
        private MapPresenter $presenter,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /games/{id}/maps?state=active|trash -> MapSummary[]
     */
    public function index(Request $request): Response
    {
        $maps = $this->maps->list(CurrentUser::require($request), self::id($request), $request->query);

        return Response::ok($this->presenter->summaries($maps));
    }

    /**
     * POST /games/{id}/maps {name, folder?, kind?, width, height, cell_px?, unit_label?, unit_per_cell?, theme?} -> 201 Map
     */
    public function create(Request $request): Response
    {
        $map = $this->maps->create(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::ok($this->presenter->full($map, $this->apiBase($request)), [], 201);
    }

    /**
     * GET /maps/{id} -> Map
     */
    public function show(Request $request): Response
    {
        $map = $this->maps->show(CurrentUser::require($request), self::id($request));

        return Response::ok($this->presenter->full($map, $this->apiBase($request)));
    }

    /**
     * PATCH /maps/{id} {name?, folder?, sort_order?} -> MapSummary
     */
    public function update(Request $request): Response
    {
        $map = $this->maps->update(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::ok($this->presenter->summary($map));
    }

    /**
     * DELETE /maps/{id} -> 204 (trash)
     */
    public function delete(Request $request): Response
    {
        $this->maps->delete(CurrentUser::require($request), self::id($request));

        return Response::noContent();
    }

    /**
     * POST /maps/{id}/restore -> MapSummary
     */
    public function restore(Request $request): Response
    {
        $map = $this->maps->restore(CurrentUser::require($request), self::id($request));

        return Response::ok($this->presenter->summary($map));
    }

    /**
     * POST /maps/{id}/duplicate {name?} -> 201 Map
     */
    public function duplicate(Request $request): Response
    {
        $map = $this->maps->duplicate(CurrentUser::require($request), self::id($request), self::body($request));

        return Response::ok($this->presenter->full($map, $this->apiBase($request)), [], 201);
    }

    /**
     * POST /maps/{id}/ops {base_revision, client_op_id, ops} -> {revision, applied, conflicts}
     */
    public function ops(Request $request): Response
    {
        return Response::ok($this->ops->apply(CurrentUser::require($request), self::id($request), self::body($request)));
    }

    /**
     * GET /maps/{id}/chunks?floor=&layers=&cells= -> application/octet-stream, X-Map-Revision
     */
    public function chunks(Request $request): Response
    {
        $result = $this->maps->chunks(CurrentUser::require($request), self::id($request), $request->query);

        return new Response($result['body'], 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Length' => (string) strlen($result['body']),
            'X-Map-Revision' => (string) $result['revision'],
            'X-Content-Type-Options' => 'nosniff',
        ]);
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
