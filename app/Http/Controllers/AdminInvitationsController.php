<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\NotFoundException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Invitations\InvitationService;
use JDR\Domain\Support\Validator;

/**
 * /admin/invitations (routes with role=admin).
 */
final class AdminInvitationsController
{
    public function __construct(private InvitationService $invitations, private AuditLog $audit)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok($this->invitations->list());
    }

    /**
     * POST /admin/invitations {email?, max_uses, expires_in_days?} -> 201 {invitation, code, url}
     * The code is shown only once (stored hashed).
     */
    public function create(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $email = $v->email('email', false);
        $maxUses = $v->int('max_uses', false, 1, 10000) ?? 1;
        $days = $v->int('expires_in_days', false, 1, 365);
        $v->validate();
        $result = $this->invitations->create($admin->id, $email, $maxUses, $days);
        $this->audit->record($admin->id, 'invitation.create', 'invitation', (int) $result['invitation']['id'], [
            'email' => $email,
            'max_uses' => $maxUses,
            'expires_in_days' => $days,
        ], $request->ip());

        return Response::ok($result, [], 201);
    }

    public function delete(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $id = (int) $request->param('id');
        if (!$this->invitations->delete($id)) {
            throw new NotFoundException();
        }
        $this->audit->record($admin->id, 'invitation.delete', 'invitation', $id, null, $request->ip());

        return Response::noContent();
    }
}
