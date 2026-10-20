<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Real HTTP requests from PHP to its own site (projet.md 19, step 1):
 * routing mode detection and private folder protection (canary files).
 */
final class Probe
{
    /** Marker present in app/canary.txt and in the temporary storage canary. */
    public const CANARY_MARKER = 'JDR-CANARY-3b7f9c2e';

    public function __construct(private HttpClient $http)
    {
    }

    /**
     * "rewrite" when {base}/api/v1/health answers the health JSON, else "query" when
     * {base}/index.php?r=/api/v1/health does, else null (with the reason in the check).
     */
    public function routingMode(string $baseUrl): Check
    {
        $base = rtrim($baseUrl, '/');
        $rewrite = $this->http->get($base . '/api/v1/health');
        if ($rewrite !== null && self::isHealth($rewrite)) {
            return new Check('routing', Check::OK, 'req.routing', 'rewrite', 'req.routing.rewrite');
        }
        $query = $this->http->get($base . '/index.php?r=/api/v1/health');
        if ($query !== null && self::isHealth($query)) {
            return new Check('routing', Check::WARN, 'req.routing', 'query', 'req.routing.query');
        }
        if ($rewrite === null && $query === null) {
            // No HTTP answer at all: the host forbids self-requests (or a single-process server).
            return new Check('routing', Check::WARN, 'req.routing', 'query', 'req.routing.unreachable');
        }
        $status = $query?->status ?? $rewrite?->status ?? 0;
        if ($status >= 500) {
            return new Check('routing', Check::ERROR, 'req.routing', 'HTTP ' . $status, 'req.routing.server_error');
        }

        return new Check('routing', Check::ERROR, 'req.routing', 'HTTP ' . $status, 'req.routing.none');
    }

    /**
     * A private file must answer 403/404. 200 with the canary content = exposed (red).
     */
    public function privateFile(string $id, string $url, string $label): Check
    {
        $result = $this->http->get($url);
        if ($result === null) {
            return new Check($id, Check::WARN, $label, '?', 'req.protect.unknown', ['url' => $url]);
        }
        if ($result->status === 403 || $result->status === 404 || $result->status === 401) {
            return new Check($id, Check::OK, $label, 'HTTP ' . $result->status);
        }
        if ($result->status >= 200 && $result->status < 300 && str_contains($result->body, self::CANARY_MARKER)) {
            return new Check($id, Check::ERROR, $label, 'HTTP ' . $result->status, 'req.protect.exposed');
        }

        // Redirect, 5xx or a 200 page that is not the file: probably safe but unverified.
        return new Check($id, Check::WARN, $label, 'HTTP ' . $result->status, 'req.protect.unknown', ['url' => $url]);
    }

    private static function isHealth(HttpResult $result): bool
    {
        if ($result->status !== 200) {
            return false;
        }
        $json = $result->json();
        $data = $json['data'] ?? null;

        return ($json['ok'] ?? null) === true && is_array($data) && ($data['status'] ?? null) === 'ok';
    }
}
