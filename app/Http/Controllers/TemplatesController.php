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
use JDR\Domain\Maps\MapTemplates;

/**
 * Map templates (P9c1): GET /templates, POST /maps/{id}/save-as-template {name, scope},
 * POST /templates/{id}/instantiate {game_id, name?} (201, a Map like POST /maps/{id}/duplicate),
 * DELETE /templates/{id}. Rights and visibility: MapTemplates.
 */
final class TemplatesController
{
    public function __construct(private MapTemplates $templates, private MapPresenter $presenter, private Config $config)
    {
    }

    /**
     * GET /templates: lists the templates available to the user.
     */
    public function index(Request $request): Response
    {
        return Response::ok($this->templates->list(CurrentUser::require($request)));
    }

    /**
     * POST /maps/{id}/save-as-template: stores a copy of the map as a template.
     */
    public function save(Request $request): Response
    {
        return Response::ok($this->templates->saveAs(CurrentUser::require($request), (int) $request->param('id'), self::body($request)), [], 201);
    }

    /**
     * POST /templates/{id}/instantiate: creates a new map from a template and returns it.
     */
    public function instantiate(Request $request): Response
    {
        $map = $this->templates->instantiate(CurrentUser::require($request), (int) $request->param('id'), self::body($request));

        return Response::ok($this->presenter->full($map, Input::apiBase($request, $this->config), true), [], 201);
    }

    /**
     * DELETE /templates/{id}: deletes a map template.
     */
    public function delete(Request $request): Response
    {
        $this->templates->delete(CurrentUser::require($request), (int) $request->param('id'));

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
