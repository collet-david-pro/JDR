<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Integrity\IntegrityFixer;
use JDR\Domain\Integrity\IntegrityScanner;

/**
 * /admin/integrity (role=admin): check by slices and corrections (projet.md 8.5).
 */
final class AdminIntegrityController
{
    public function __construct(private IntegrityScanner $scanner, private IntegrityFixer $fixer)
    {
    }

    /**
     * POST /admin/integrity/check {cursor?} => {issues, cursor, progress}
     */
    public function check(Request $request): Response
    {
        $body = $request->parsedBody();
        $cursor = is_array($body) ? ($body['cursor'] ?? null) : null;
        if ($cursor !== null && (!is_string($cursor) || strlen($cursor) > 200)) {
            throw new ValidationException('', ['cursor' => 'invalid']);
        }
        try {
            $slice = $this->scanner->slice($cursor);
        } catch (\InvalidArgumentException) {
            throw new ValidationException('', ['cursor' => 'invalid']);
        }

        return Response::ok([
            'issues' => array_map(static fn ($i): array => $i->toArray(), $slice['issues']),
            'cursor' => $slice['cursor'],
            'progress' => $slice['progress'],
        ]);
    }

    /**
     * POST /admin/integrity/fix {issues: [{id, kind, subject}], confirm?} => {fixed, skipped}
     */
    public function fix(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $body = $request->parsedBody();
        $body = is_array($body) ? $body : [];
        $list = $body['issues'] ?? null;
        if (!is_array($list) || !array_is_list($list) || $list === [] || count($list) > IntegrityFixer::MAX_ISSUES) {
            throw new ValidationException('', ['issues' => 'invalid']);
        }
        $requested = [];
        foreach ($list as $item) {
            if (!is_array($item) || !is_string($item['id'] ?? null) || !is_string($item['kind'] ?? null) || strlen($item['id']) > 300) {
                throw new ValidationException('', ['issues' => 'invalid']);
            }
            $requested[] = ['id' => $item['id'], 'kind' => $item['kind']];
        }

        return Response::ok($this->fixer->fix($admin->id, $requested, ($body['confirm'] ?? false) === true, $request->ip()));
    }
}
