<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Procgen\BasePackInstaller;

/**
 * POST /admin/base-pack/install (role=admin): installs or repairs the base pack, by time-boxed calls
 * (the client repeats while `complete` is false). Body {resume?: bool}: without it, failures are retried.
 */
final class AdminBasePackController
{
    public function __construct(private BasePackInstaller $installer, private AuditLog $audit)
    {
    }

    public function install(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $body = $request->parsedBody();
        $resume = is_array($body) && ($body['resume'] ?? false) === true;
        $report = $this->installer->installSlice(BasePackInstaller::SLICE * 4, 15.0, !$resume);
        $this->audit->record($admin->id, 'base_pack.install', 'base_pack', null, [
            'installed' => $report['installed'],
            'present' => $report['present'],
            'failed' => count($report['failed']),
            'remaining' => $report['remaining'],
        ], $request->ip());

        return Response::ok($report);
    }
}
