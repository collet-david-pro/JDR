<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Errors\BadRequestException;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\I18n;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\AssetImporter;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetPolicy;
use JDR\Domain\Assets\AssetPresenter;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetService;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\CategoryService;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Assets\Input;
use JDR\Domain\Assets\TagService;
use JDR\Domain\Assets\UploadedFile;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Support\Validator;

/**
 * /assets: library, upload (projet.md 11.3), edit, delete, usages, favorites (routes with auth=true).
 */
final class AssetsController
{
    public function __construct(
        private AssetRepository $assets,
        private AssetPolicy $policy,
        private AssetPresenter $presenter,
        private AssetService $service,
        private AssetImporter $importer,
        private AssetLimits $limits,
        private AssetStorage $storage,
        private CategoryService $categories,
        private TagService $tags,
        private I18n $i18n,
        private GamePolicy $games,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /assets/limits
     */
    public function limits(Request $request): Response
    {
        CurrentUser::require($request);

        return Response::ok($this->limits->toArray());
    }

    /**
     * GET /assets?scope=mine|general|game:{id}&kind=&q=&tag=&category=&favorites=1&cursor=&limit=
     */
    public function index(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $query = $request->query;
        $errors = [];
        $scope = $query['scope'] ?? 'mine';
        $gameId = null;
        if (is_string($scope) && preg_match('/^game:(\d{1,19})$/D', $scope, $m) === 1) {
            $gameId = (int) $m[1];
            $scope = 'game';
        } elseif (!in_array($scope, ['mine', 'general'], true)) {
            $errors['scope'] = 'invalid';
        }
        $kind = self::queryString($query, 'kind');
        if ($kind !== null && !in_array($kind, Asset::KINDS, true)) {
            $errors['kind'] = 'invalid';
        }
        $q = self::queryString($query, 'q');
        if ($q !== null && mb_strlen($q, 'UTF-8') > 120) {
            $errors['q'] = 'too_long';
        }
        $category = null;
        try {
            $category = Input::id(self::queryString($query, 'category'), 'category');
        } catch (ValidationException) {
            $errors['category'] = 'invalid';
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $tag = self::queryString($query, 'tag');
        $favorites = in_array($query['favorites'] ?? null, ['1', 'true'], true);
        [$cursor, $limit] = Input::paging($request);
        $assetIds = [];
        if ($gameId !== null) {
            // Contract P3 / D8: GM and co-GM get every asset of the game, a player only the cover
            // and the images of the tokens they own by default; non-members 404.
            $game = $this->games->requireView($user, $gameId);
            $assetIds = $this->assets->gameAssetIds($game->id, $game->isEditor() ? null : $user->id);
        }
        $page = $this->assets->page($user->id, [
            'scope' => (string) $scope,
            'asset_ids' => $assetIds,
            'kind' => $kind,
            'q' => $q,
            'tag_ids' => $tag === null ? null : $this->tags->visibleIds($user->id, $tag),
            'category_id' => $category,
            'favorites' => $favorites,
        ], $cursor, $limit);

        return Response::ok(
            $this->presenter->many($page['items'], $user, Input::apiBase($request, $this->config)),
            ['next_cursor' => $page['next_cursor']],
        );
    }

    /**
     * GET /assets/{id}
     */
    public function show(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $asset = $this->policy->requireView($user, $this->assets->find((int) $request->param('id')));

        return Response::ok($this->presenter->one($asset, $user, Input::apiBase($request, $this->config)));
    }

    /**
     * POST /assets (multipart: file, kind, name?, category_id?, scope?, client_op_id?)
     * -> 201 Asset; duplicate -> 200 Asset + meta.duplicate.
     */
    public function create(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $max = $this->limits->maxUploadBytes();
        $length = $request->header('content-length');
        if ($length !== null && ctype_digit($length) && (int) $length > $max + AssetLimits::MULTIPART_MARGIN) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $fields = UploadedFile::fields($request);
        $file = UploadedFile::fromRequest($request, 'file');
        if ($file === null && $fields === [] && $length !== null && (int) $length > 0) {
            // PHP dropped the body: larger than post_max_size.
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $v = new Validator($fields);
        $kind = $v->in('kind', Asset::KINDS);
        $name = $v->string('name', false, 1, 120);
        $scope = $v->in('scope', [Asset::SCOPE_PERSONAL, Asset::SCOPE_GENERAL], false) ?? Asset::SCOPE_PERSONAL;
        $clientOpId = $v->string('client_op_id', false, 1, 40);
        $categoryId = null;
        try {
            $categoryId = Input::id($fields['category_id'] ?? null, 'category_id');
        } catch (ValidationException) {
            $v->error('category_id', 'invalid');
        }
        if ($file === null || $file->error === UPLOAD_ERR_NO_FILE) {
            $v->error('file', 'required');
        }
        $v->validate();
        assert($file !== null && $kind !== null);
        match ($file->error) {
            UPLOAD_ERR_OK => null,
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => throw new PayloadTooLargeException('', [], 'file_too_large'),
            UPLOAD_ERR_PARTIAL => throw new BadRequestException('', [], 'bad_request'),
            default => throw new \RuntimeException('Upload failed (UPLOAD_ERR ' . $file->error . ').'),
        };
        if ($file->size > $max) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $owner = $this->policy->ownerFor($user, $scope);
        $categoryId = $this->categories->requireUsable($categoryId, $owner);
        $apiBase = Input::apiBase($request, $this->config);

        if ($clientOpId !== null) {
            $replay = $this->service->replayed($user, $clientOpId);
            $previous = $replay === null ? null : $this->assets->find($replay['asset_id']);
            if ($replay !== null && $previous !== null && $previous->deletedAt === null && $this->policy->canView($user, $previous)) {
                return Response::ok(
                    $this->presenter->one($previous, $user, $apiBase),
                    $replay['duplicate'] ? ['duplicate' => true] : [],
                    $replay['duplicate'] ? 200 : 201,
                );
            }
        }

        $tmp = $this->storage->newTmpPath();
        if (!$file->moveTo($tmp)) {
            throw new \RuntimeException('Cannot move the uploaded file to storage/tmp.');
        }
        $result = $this->importer->import($tmp, new ImportRequest(
            $owner,
            $name ?? ImportRequest::nameFromFile($file->clientName),
            $kind,
            $categoryId,
            [],
            'upload',
        ));
        if ($clientOpId !== null) {
            $this->service->remember($user, $clientOpId, $result->asset, $result->duplicate);
        }

        return Response::ok(
            $this->presenter->one($result->asset, $user, $apiBase),
            $result->duplicate ? ['duplicate' => true] : [],
            $result->duplicate ? 200 : 201,
        );
    }

    /**
     * PATCH /assets/{id} {name?, kind?, category_id?, tags?: string[]}
     */
    public function update(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $asset = $this->policy->requireEdit($user, $this->assets->find((int) $request->param('id')));
        $v = Validator::fromRequest($request);
        $changes = [];
        if ($v->has('name')) {
            $changes['name'] = $v->string('name', true, 1, 120);
        }
        if ($v->has('kind')) {
            $changes['kind'] = $v->in('kind', Asset::KINDS);
        }
        if ($v->has('category_id')) {
            try {
                $changes['category_id'] = Input::id($v->raw('category_id'), 'category_id');
            } catch (ValidationException) {
                $v->error('category_id', 'invalid');
            }
        }
        if ($v->has('tags')) {
            try {
                $changes['tags'] = AssetService::tagNames($v->raw('tags'));
            } catch (ValidationException) {
                $v->error('tags', 'invalid');
            }
        }
        $v->validate();
        /** @var array{name?: string, kind?: string, category_id?: ?int, tags?: list<string>} $changes */
        $updated = $this->service->update($asset, $changes);

        return Response::ok($this->presenter->one($updated, $user, Input::apiBase($request, $this->config)));
    }

    /**
     * DELETE /assets/{id}[?force=1] -> 204, or 409 asset_in_use with the usages.
     */
    public function delete(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $asset = $this->policy->requireEdit($user, $this->assets->find((int) $request->param('id')));
        $force = in_array($request->query['force'] ?? null, ['1', 'true'], true);
        $usages = $this->service->delete($asset, $user, $force);
        if ($usages !== null) {
            return Response::json([
                'ok' => false,
                'error' => [
                    'code' => 'asset_in_use',
                    'message' => $this->i18n->has('errors.asset_in_use')
                        ? $this->i18n->t('errors.asset_in_use')
                        : 'Cet asset est utilisé.',
                    'fields' => new \stdClass(),
                    'usages' => \JDR\Core\Ids::stringify($usages),
                ],
            ], 409);
        }

        return Response::noContent();
    }

    /**
     * GET /assets/{id}/usages -> {maps, tokens}
     */
    public function usages(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $asset = $this->policy->requireEdit($user, $this->assets->find((int) $request->param('id')));

        return Response::ok($this->service->usages($asset, $user));
    }

    /**
     * PUT /assets/{id}/favorite -> 204
     */
    public function favorite(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $asset = $this->policy->requireView($user, $this->assets->find((int) $request->param('id')));
        $this->service->setFavorite($user, $asset, true);

        return Response::noContent();
    }

    /**
     * DELETE /assets/{id}/favorite -> 204
     */
    public function unfavorite(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $asset = $this->policy->requireView($user, $this->assets->find((int) $request->param('id')));
        $this->service->setFavorite($user, $asset, false);

        return Response::noContent();
    }

    /**
     * @param array<string, mixed> $query
     */
    private static function queryString(array $query, string $key): ?string
    {
        $value = $query[$key] ?? null;
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' || preg_match('//u', $value) !== 1 ? null : $value;
    }
}
