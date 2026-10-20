<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\SystemStatus;

final class SystemController
{
    public function __construct(private SystemStatus $status)
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
     * GET /version
     */
    public function version(Request $request): Response
    {
        return Response::ok([
            'version' => \APP_VERSION,
            'protocol' => \PROTOCOL_VERSION,
            'required_db_version' => \REQUIRED_DB_VERSION,
        ]);
    }
}
