<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Invitations\InvitationService;

final class InvitationController
{
    public function __construct(private InvitationService $invitations)
    {
    }

    /**
     * GET /invitations/{code} (public) -> {valid, email}
     */
    public function show(Request $request): Response
    {
        $code = (string) $request->param('code');
        if (strlen($code) > 64) {
            return Response::ok(['valid' => false, 'email' => null]);
        }

        return Response::ok($this->invitations->check($code));
    }
}
