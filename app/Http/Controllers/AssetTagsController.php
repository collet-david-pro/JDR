<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\TagService;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Support\Validator;

/**
 * /asset-tags: own + general tags. General ones are managed by admins.
 */
final class AssetTagsController
{
    public function __construct(private TagService $tags)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok($this->tags->list(CurrentUser::require($request)));
    }

    /**
     * POST {name, scope?: personal|general} -> 201 Tag; existing name -> 422 name=taken
     */
    public function create(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $raw = $v->string('name', true, 1, TagService::MAX_LENGTH);
        $scope = $v->in('scope', [Asset::SCOPE_PERSONAL, Asset::SCOPE_GENERAL], false) ?? Asset::SCOPE_PERSONAL;
        $name = $raw === null ? null : TagService::normalize($raw);
        if ($raw !== null && $name === null) {
            $v->error('name', 'invalid');
        }
        $v->validate();

        return Response::ok($this->tags->create($user, (string) $name, $scope), [], 201);
    }

    public function delete(Request $request): Response
    {
        $this->tags->delete(CurrentUser::require($request), (int) $request->param('id'));

        return Response::noContent();
    }
}
