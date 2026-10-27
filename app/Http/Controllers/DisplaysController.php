<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Displays\DisplayService;

/**
 * Projection screens, GM side (contract P7a "Endpoints MJ"). Rights: SessionAccess::requireGm.
 */
final class DisplaysController
{
    public function __construct(private DisplayService $displays)
    {
    }

    /**
     * POST /sessions/{id}/displays {name} -> 201 Display with "pairing" (409 display_limit | invalid_transition)
     */
    public function create(Request $request): Response
    {
        return Response::ok($this->displays->create(CurrentUser::require($request), self::id($request), self::body($request)), [], 201);
    }

    /**
     * GET /sessions/{id}/displays -> {displays}
     */
    public function index(Request $request): Response
    {
        return Response::ok($this->displays->list(CurrentUser::require($request), self::id($request)));
    }

    /**
     * PATCH /displays/{id} {name?, settings?} -> Display
     */
    public function update(Request $request): Response
    {
        return Response::ok($this->displays->update(CurrentUser::require($request), self::id($request), self::body($request)));
    }

    /**
     * DELETE /displays/{id} -> 204
     */
    public function destroy(Request $request): Response
    {
        $this->displays->revoke(CurrentUser::require($request), self::id($request));

        return Response::noContent();
    }

    /**
     * POST /displays/{id}/regenerate-code -> Display with "pairing" (409 display_not_pending)
     */
    public function regenerateCode(Request $request): Response
    {
        return Response::ok($this->displays->regenerateCode(CurrentUser::require($request), self::id($request)));
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
