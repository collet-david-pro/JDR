<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Admin\AdminStats;
use JDR\Domain\Admin\Diagnostic;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Support\AppPaths;
use JDR\Domain\Support\Dates;
use JDR\Migrate\Runner;

/**
 * Admin dashboard, diagnostic (+ SSE test stream), audit log, migrations (routes with role=admin).
 */
final class AdminSystemController
{
    public function __construct(
        private AdminStats $stats,
        private Diagnostic $diagnostic,
        private AuditLog $audit,
        private Db $db,
        private AppPaths $paths,
    ) {
    }

    public function stats(Request $request): Response
    {
        return Response::ok($this->stats->compute());
    }

    public function diagnostic(Request $request): Response
    {
        return Response::ok(['checks' => $this->diagnostic->run($request)]);
    }

    /**
     * GET /admin/diagnostic/sse: 3 events one second apart, flushed one by one; the browser checks
     * that they arrive spaced out (an output buffer would deliver them together).
     * Route option session_close: the session is released before streaming.
     */
    public function sse(Request $request): Response
    {
        $event = static fn (int $n): string => 'id: ' . $n . "\nevent: ping\ndata: " . json_encode([
            'n' => $n,
            'sent_at' => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
        ]) . "\n\n";
        $headers = [
            'Content-Type' => 'text/event-stream; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Accel-Buffering' => 'no',
        ];
        if (PHP_SAPI === 'cli') {
            return new Response("retry: 3000\n\n" . $event(1) . $event(2) . $event(3), 200, $headers);
        }
        @set_time_limit(30);
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        if (!headers_sent()) {
            http_response_code(200);
            foreach ($headers + ['X-Content-Type-Options' => 'nosniff', 'X-Request-Id' => $request->id] as $name => $value) {
                header($name . ': ' . $value);
            }
        }
        echo "retry: 3000\n\n";
        flush();
        for ($n = 1; $n <= 3; $n++) {
            if ($n > 1) {
                sleep(1);
            }
            echo $event($n);
            flush();
            if (connection_aborted() === 1) {
                break;
            }
        }

        return new Response('', 200, $headers);
    }

    /**
     * GET /admin/audit?cursor=&limit=
     */
    public function audit(Request $request): Response
    {
        [$cursor, $limit] = AdminUsersController::paging($request);
        $page = $this->audit->page($cursor, $limit);

        return Response::ok($page['items'], ['next_cursor' => $page['next_cursor']]);
    }

    /**
     * GET /admin/migrations -> [{version, name, status, applied_at, duration_ms, checksum_ok}]
     */
    public function migrations(Request $request): Response
    {
        $runner = new Runner($this->db, $this->paths->codeRoot . '/migrations');
        $rows = array_map(static fn (array $m): array => [
            'version' => $m['version'],
            'name' => $m['name'],
            'status' => $m['status'],
            'applied_at' => Dates::iso($m['applied_at']),
            'duration_ms' => $m['duration_ms'],
            'checksum_ok' => $m['checksum_ok'],
        ], $runner->status());

        return Response::ok($rows);
    }
}
