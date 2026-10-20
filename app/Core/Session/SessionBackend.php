<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Session storage. A singleton service: per-request state lives in Session.
 * NativeSessionBackend wraps PHP sessions (files or DbSessionHandler);
 * MemorySessionBackend keeps sessions in memory for tests (no session_start() in CLI).
 */
interface SessionBackend
{
    /**
     * Opens (and locks) the session named by the request cookie, or a new one (strict mode:
     * an unknown id is never accepted).
     *
     * @return array{0: string, 1: array<string, mixed>} [id, data]
     */
    public function start(SessionOptions $options, ?string $cookieId): array;

    /**
     * Writes the data and releases the session (session_write_close()).
     *
     * @param array<string, mixed> $data
     */
    public function commit(string $id, array $data): void;

    /**
     * Changes the session id, keeps the data, deletes the old session. Returns the new id.
     *
     * @param array<string, mixed> $data
     */
    public function regenerate(SessionOptions $options, string $id, array $data): string;

    /**
     * Deletes the session and expires its cookie.
     */
    public function destroy(SessionOptions $options, string $id): void;
}
