<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\CategoryService;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Support\Validator;

/**
 * /asset-categories: own + general categories (tree). General ones are managed by admins.
 */
final class AssetCategoriesController
{
    public function __construct(private CategoryService $categories)
    {
    }

    public function index(Request $request): Response
    {
        return Response::ok($this->categories->list(CurrentUser::require($request)));
    }

    /**
     * POST {name, parent_id?, scope?: personal|general} -> 201 Category
     */
    public function create(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $name = $v->string('name', true, 1, 80);
        $scope = $v->in('scope', [Asset::SCOPE_PERSONAL, Asset::SCOPE_GENERAL], false) ?? Asset::SCOPE_PERSONAL;
        $parent = $this->id($v, 'parent_id');
        $v->validate();

        return Response::ok($this->categories->create($user, (string) $name, $parent, $scope), [], 201);
    }

    /**
     * PATCH /asset-categories/{id} {name?, parent_id?, sort_order?}
     */
    public function update(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $changes = [];
        if ($v->has('name')) {
            $changes['name'] = $v->string('name', true, 1, 80);
        }
        if ($v->has('parent_id')) {
            $changes['parent_id'] = $this->id($v, 'parent_id');
        }
        if ($v->has('sort_order')) {
            $changes['sort_order'] = $v->int('sort_order', true, -1000000, 1000000);
        }
        $v->validate();
        /** @var array{name?: string, parent_id?: ?int, sort_order?: int} $changes */
        return Response::ok($this->categories->update($user, (int) $request->param('id'), $changes));
    }

    public function delete(Request $request): Response
    {
        $this->categories->delete(CurrentUser::require($request), (int) $request->param('id'));

        return Response::noContent();
    }

    private function id(Validator $v, string $field): ?int
    {
        try {
            return Input::id($v->raw($field), $field);
        } catch (ValidationException) {
            $v->error($field, 'invalid');

            return null;
        }
    }
}
