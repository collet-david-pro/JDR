<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Displays\DisplayAuth;
use JDR\Domain\Maps\MapSceneService;

/**
 * P5 scene routes (etapes/P05 "Contrat d'API P5"): GET|DELETE /maps/{id}/fog?floor= and
 * GET /maps/{id}/objects?floor=&bbox=. Rights: MapPolicy (GM / co-GM; player 403; others 404),
 * except GET /maps/{id}/fog, also open to a player of a running session on this map (P6 D11, filtered)
 * and to a projection screen of that session with ?as=display (table scope, P7b D7).
 */
final class MapSceneController
{
    public function __construct(private MapSceneService $scene)
    {
    }

    /**
     * GET /maps/{id}/fog?floor= -> {floor, chunks: [[cx, cy, base64]]}
     */
    public function fog(Request $request): Response
    {
        return Response::ok($this->scene->fog(DisplayAuth::of($request) ?? CurrentUser::require($request), (int) $request->param('id'), $request->query));
    }

    /**
     * DELETE /maps/{id}/fog?floor= -> {revision}
     */
    public function clearFog(Request $request): Response
    {
        return Response::ok($this->scene->clearFog(CurrentUser::require($request), (int) $request->param('id'), $request->query));
    }

    /**
     * GET /maps/{id}/objects?floor=&bbox=x1,y1,x2,y2 -> {objects}
     */
    public function objects(Request $request): Response
    {
        return Response::ok($this->scene->objects(CurrentUser::require($request), (int) $request->param('id'), $request->query));
    }
}
