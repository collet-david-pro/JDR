<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\SystemStatus;
use JDR\Http\Shell;

/**
 * Public system endpoints (health check, version).
 */
final class SystemController
{
    public function __construct(private SystemStatus $status, private Shell $shell)
    {
    }

    /**
     * GET /health: always 200 while PHP runs; database state in "db".
     */
    public function health(Request $request): Response
    {
        return Response::ok([
            'status' => 'ok',
            'db' => $this->status->db(),
            'db_version' => $this->status->dbVersion(),
        ]);
    }

    /**
     * GET /version. "build" and "maintenance" let an open page reload itself after a site update
     * (frontend/src/lib/version-watch.ts), once the maintenance is over.
     */
    public function version(Request $request): Response
    {
        return Response::ok([
            'version' => \APP_VERSION,
            'protocol' => \PROTOCOL_VERSION,
            'required_db_version' => \REQUIRED_DB_VERSION,
            'build' => $this->shell->build(),
            'maintenance' => $this->status->needsMaintenance(\REQUIRED_DB_VERSION),
        ]);
    }
}
