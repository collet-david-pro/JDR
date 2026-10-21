<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Tokens\TokenPresenter;
use JDR\Domain\Tokens\TokenService;

/**
 * Token definitions (contract P3): /games/{id}/tokens and /tokens/{id}.
 */
final class TokensController
{
    public function __construct(
        private TokenService $tokens,
        private TokenPresenter $presenter,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /games/{id}/tokens -> Token[] (GM/co-GM: all; player: own by default)
     */
    public function index(Request $request): Response
    {
        [, $tokens] = $this->tokens->listFor(CurrentUser::require($request), (int) $request->param('id'));

        return Response::ok($this->presenter->many($tokens, $this->apiBase($request)));
    }

    /**
     * POST /games/{id}/tokens (GM/co-GM) -> 201 Token
     */
    public function create(Request $request): Response
    {
        $token = $this->tokens->create(CurrentUser::require($request), (int) $request->param('id'), self::body($request));

        return Response::ok($this->presenter->one($token, $this->apiBase($request)), [], 201);
    }

    /**
     * GET /tokens/{id} (GM/co-GM, or the default owner)
     */
    public function show(Request $request): Response
    {
        $token = $this->tokens->requireView(CurrentUser::require($request), (int) $request->param('id'));

        return Response::ok($this->presenter->one($token, $this->apiBase($request)));
    }

    /**
     * PATCH /tokens/{id} (GM/co-GM) -> Token
     */
    public function update(Request $request): Response
    {
        $token = $this->tokens->update(CurrentUser::require($request), (int) $request->param('id'), self::body($request));

        return Response::ok($this->presenter->one($token, $this->apiBase($request)));
    }

    /**
     * DELETE /tokens/{id} (GM/co-GM) -> 204 (soft delete)
     */
    public function delete(Request $request): Response
    {
        $this->tokens->delete(CurrentUser::require($request), (int) $request->param('id'));

        return Response::noContent();
    }

    private function apiBase(Request $request): string
    {
        return Input::apiBase($request, $this->config);
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
