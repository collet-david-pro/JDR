<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Where an SSE stream is written: the client connection (PhpSseOutput) or a buffer (tests, CLI).
 */
interface SseOutput
{
    /**
     * Prepares the transport and sends the status line and headers.
     *
     * @param array<string, string> $headers
     */
    public function start(array $headers): void;

    public function write(string $data): void;

    public function flush(): void;

    /**
     * The client went away: stop the loop.
     */
    public function aborted(): bool;
}
