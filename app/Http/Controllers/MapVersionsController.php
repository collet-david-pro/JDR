<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Maps\MapPresenter;
use JDR\Domain\Maps\Versions\MapVersionService;

/**
 * Map versions (contract P4c): GET|POST /maps/{id}/versions, POST /maps/{id}/versions/{vid}/restore.
 * Rights: MapPolicy (GM / co-GM; player 403; others 404).
 */
final class MapVersionsController
{
    public function __construct(
        private MapVersionService $versions,
        private MapPresenter $presenter,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /maps/{id}/versions -> MapVersion[] (most recent first)
     */
    public function index(Request $request): Response
    {
        return Response::ok($this->versions->list(CurrentUser::require($request), (int) $request->param('id')));
    }

    /**
     * POST /maps/{id}/versions {label?, kind?: manual|pre_generate} -> 201 MapVersion
     */
    public function create(Request $request): Response
    {
        $body = $request->parsedBody();
        $version = $this->versions->create(CurrentUser::require($request), (int) $request->param('id'), is_array($body) ? $body : []);

        return Response::ok($version, [], 201);
    }

    /**
     * POST /maps/{id}/versions/{vid}/restore {client_op_id?} (or header X-Client-Op-Id) -> {revision, map: Map}
     */
    public function restore(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $body = $request->parsedBody();
        $clientOpId = is_array($body) && array_key_exists('client_op_id', $body) ? $body['client_op_id'] : $request->header('x-client-op-id');
        if ($clientOpId === '') {
            $clientOpId = null;
        }
        $result = $this->versions->restore(
            $user,
            (int) $request->param('id'),
            (int) $request->param('vid'),
            $clientOpId === null ? null : (is_string($clientOpId) ? $clientOpId : '!'),
        );

        return Response::ok([
            'revision' => $result['revision'],
            'map' => $this->presenter->full($result['map'], Input::apiBase($request, $this->config)),
        ]);
    }
}
