<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\Input;
use JDR\Domain\Assets\UploadedFile;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\PlayerTokens\PlayerTokenPresenter;
use JDR\Domain\PlayerTokens\PlayerTokenService;
use JDR\Domain\Tokens\TokenPresenter;
use JDR\Domain\Support\Validator;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;

/**
 * Personal token collection (/me/player-tokens) and the token chosen for a game (/games/{id}/my-token).
 */
final class PlayerTokensController
{
    public function __construct(
        private PlayerTokenService $service,
        private PlayerTokenPresenter $presenter,
        private TokenPresenter $tokenPresenter,
        private AssetLimits $limits,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /me/player-tokens -> PlayerToken[] and meta.max
     */
    public function index(Request $request): Response
    {
        $user = CurrentUser::require($request);

        return Response::ok(
            $this->presenter->many($this->service->list($user), $this->apiBase($request)),
            ['max' => PlayerTokenService::MAX_PER_ACCOUNT],
        );
    }

    /**
     * GET /me/player-tokens/{id}
     */
    public function show(Request $request): Response
    {
        $user = CurrentUser::require($request);

        return Response::ok($this->presenter->one($this->service->get($user, (int) $request->param('id')), $this->apiBase($request)));
    }

    /**
     * POST /me/player-tokens (multipart: file = rendered PNG, source? = portrait, name, design JSON) -> 201
     */
    public function create(Request $request): Response
    {
        $user = CurrentUser::require($request);
        [$fields, $file, $source] = $this->multipart($request);
        $row = $this->service->create($user, $fields, $file, $source);

        return Response::ok($this->presenter->one($row, $this->apiBase($request)), [], 201);
    }

    /**
     * POST /me/player-tokens/{id}/design (multipart like create; keep_source=1 keeps the portrait)
     */
    public function redesign(Request $request): Response
    {
        $user = CurrentUser::require($request);
        [$fields, $file, $source] = $this->multipart($request);
        $row = $this->service->update($user, (int) $request->param('id'), $fields, $file, $source);

        return Response::ok($this->presenter->one($row, $this->apiBase($request)));
    }

    /**
     * PATCH /me/player-tokens/{id} {name}
     */
    public function rename(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $name = $v->string('name', true, 1, PlayerTokenService::NAME_MAX);
        $v->validate();
        $row = $this->service->update($user, (int) $request->param('id'), ['name' => $name], null, null);

        return Response::ok($this->presenter->one($row, $this->apiBase($request)));
    }

    /**
     * POST /me/player-tokens/{id}/duplicate {name?} -> 201
     */
    public function duplicate(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $body = $request->parsedBody();
        $name = is_array($body) && is_string($body['name'] ?? null) ? $body['name'] : null;
        $row = $this->service->duplicate($user, (int) $request->param('id'), $name);

        return Response::ok($this->presenter->one($row, $this->apiBase($request)), [], 201);
    }

    /**
     * DELETE /me/player-tokens/{id}[?force=1] -> 204, or 409 player_token_in_use
     */
    public function delete(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $force = in_array($request->query['force'] ?? null, ['1', 'true'], true);
        $this->service->delete($user, (int) $request->param('id'), $force);

        return Response::noContent();
    }

    /**
     * GET /games/{id}/my-token -> PlayerToken|null
     */
    public function myToken(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $row = $this->service->choice($user, (int) $request->param('id'));

        return Response::ok($row === null ? null : $this->presenter->one($row, $this->apiBase($request)));
    }

    /**
     * PUT /games/{id}/my-token {player_token_id: int|null} -> the token definition of the member (or null)
     */
    public function choose(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $body = $request->parsedBody();
        $raw = is_array($body) && array_key_exists('player_token_id', $body) ? $body['player_token_id'] : false;
        if ($raw !== null && !is_int($raw) && !(is_string($raw) && ctype_digit($raw))) {
            throw new ValidationException('', ['player_token_id' => 'invalid']);
        }
        $token = $this->service->choose($user, (int) $request->param('id'), $raw === null ? null : (int) $raw);

        return Response::ok($token === null ? null : $this->tokenPresenter->one($token, $this->apiBase($request)));
    }

    /**
     * @return array{0: array<string, mixed>, 1: ?UploadedFile, 2: ?UploadedFile}
     */
    private function multipart(Request $request): array
    {
        $length = $request->header('content-length');
        if ($length !== null && ctype_digit($length) && (int) $length > 2 * $this->limits->maxUploadBytes() + AssetLimits::MULTIPART_MARGIN) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $fields = UploadedFile::fields($request);
        $file = UploadedFile::fromRequest($request, 'file');
        $source = UploadedFile::fromRequest($request, 'source');
        if ($file === null && $fields === [] && $length !== null && (int) $length > 0) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }

        return [$fields, $file, $source];
    }

    private function apiBase(Request $request): string
    {
        return Input::apiBase($request, $this->config);
    }
}
