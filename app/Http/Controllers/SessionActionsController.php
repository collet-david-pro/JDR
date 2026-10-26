<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Sessions\Actions\ActionService;

/**
 * POST /sessions/{id}/actions {client_op_id?, actions: [...]} -> {results, last_event_id}
 * (contract P6 "Actions de séance"; rules in ActionService).
 */
final class SessionActionsController
{
    public function __construct(private ActionService $actions)
    {
    }

    public function apply(Request $request): Response
    {
        $body = $request->parsedBody();

        return Response::ok($this->actions->apply(CurrentUser::require($request), (int) $request->param('id'), is_array($body) ? $body : []));
    }
}
