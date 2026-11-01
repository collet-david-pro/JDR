<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Maps\MapLinks;
use JDR\Domain\Maps\MapPolicy;

/**
 * GET /maps/{id}/links (P9a1) -> {outgoing: [{object_uid, floor, to: {map_id, map_name, floor, floor_name, x, y},
 * broken}], incoming: [{map_id, map_name, object_uid}]}. Rights: MapPolicy (GM / co-GM).
 */
final class MapLinksController
{
    public function __construct(private MapPolicy $policy, private MapLinks $links)
    {
    }

    public function show(Request $request): Response
    {
        [$map] = $this->policy->requireEdit(CurrentUser::require($request), (int) $request->param('id'));

        return Response::ok($this->links->report($map->id));
    }
}
