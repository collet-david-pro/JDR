<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * JSON-lines logger: storage/logs/app-YYYY-MM-DD.log (projet.md 6.6).
 * Fields: ts, level, msg, request_id, user_id, route, ms, ctx. Secrets are redacted.
 */
final class Logger
{
    private const LEVELS = ['debug' => 0, 'info' => 1, 'warning' => 2, 'error' => 3, 'critical' => 4];

    private const SECRET_PATTERN =
        '/pass|pwd|secret|token|cookie|csrf|authorization|cron_key|session_code|pair_code|signature/i';

    private ?string $requestId = null;
    private ?string $userId = null;
    private ?string $route = null;
    private float $startedAt;

    /**
     * @param string|null $directory null = discard (tests)
     */
    public function __construct(private ?string $directory, private Clock $clock, private string $minLevel = 'info')
    {
        $this->startedAt = microtime(true);
    }

    public static function discard(): self
    {
        return new self(null, new Clock());
    }

    public function setDirectory(?string $directory): void
    {
        $this->directory = $directory;
    }

    public function setMinLevel(string $level): void
    {
        if (isset(self::LEVELS[$level])) {
            $this->minLevel = $level;
        }
    }

    public function setRequestContext(?string $requestId, ?string $route = null, ?float $startedAt = null): void
    {
        $this->requestId = $requestId;
        $this->route = $route;
        if ($startedAt !== null) {
            $this->startedAt = $startedAt;
        }
    }

    public function setRoute(?string $route): void
    {
        $this->route = $route;
    }

    public function setUserId(int|string|null $userId): void
    {
        $this->userId = $userId === null ? null : (string) $userId;
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public function debug(string $msg, array $ctx = []): void
    {
        $this->log('debug', $msg, $ctx);
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public function info(string $msg, array $ctx = []): void
    {
        $this->log('info', $msg, $ctx);
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public function warning(string $msg, array $ctx = []): void
    {
        $this->log('warning', $msg, $ctx);
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public function error(string $msg, array $ctx = []): void
    {
        $this->log('error', $msg, $ctx);
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public function critical(string $msg, array $ctx = []): void
    {
        $this->log('critical', $msg, $ctx);
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public function log(string $level, string $msg, array $ctx = []): void
    {
        $level = isset(self::LEVELS[$level]) ? $level : 'error';
        if (self::LEVELS[$level] < (self::LEVELS[$this->minLevel] ?? 1) || $this->directory === null) {
            return;
        }
        $entry = [
            'ts' => $this->clock->iso(),
            'level' => $level,
            'msg' => $msg,
            'request_id' => $this->requestId,
            'user_id' => $this->userId,
            'route' => $this->route,
            'ms' => (int) round((microtime(true) - $this->startedAt) * 1000),
            'ctx' => $ctx === [] ? new \stdClass() : self::redact($ctx),
        ];
        try {
            $line = json_encode($entry, Response::JSON_FLAGS) . "\n";
        } catch (\JsonException) {
            $line = json_encode(['ts' => $entry['ts'], 'level' => $level, 'msg' => $msg]) . "\n";
        }
        $this->write($line);
    }

    /**
     * Exception context for logs (no arguments, which may contain secrets).
     *
     * @return array<string, mixed>
     */
    public static function exceptionContext(\Throwable $e): array
    {
        return [
            'exception' => get_class($e),
            'message' => $e->getMessage(),
            'file' => $e->getFile() . ':' . $e->getLine(),
            'trace' => array_slice(explode("\n", $e->getTraceAsString()), 0, 15),
        ];
    }

    /**
     * @param array<array-key, mixed> $data
     * @return array<array-key, mixed>
     */
    public static function redact(array $data): array
    {
        $out = [];
        foreach ($data as $key => $value) {
            if (is_string($key) && preg_match(self::SECRET_PATTERN, $key) === 1) {
                $out[$key] = '[redacted]';
            } elseif (is_array($value)) {
                $out[$key] = self::redact($value);
            } else {
                $out[$key] = $value;
            }
        }

        return $out;
    }

    private function write(string $line): void
    {
        $dir = (string) $this->directory;
        $file = $dir . '/app-' . $this->clock->now()->format('Y-m-d') . '.log';
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }
        if (@file_put_contents($file, $line, FILE_APPEND | LOCK_EX) === false) {
            error_log('[jdr] ' . rtrim($line));
        }
    }
}
