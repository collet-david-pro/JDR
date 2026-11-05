<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * SSE into memory (tests, CLI requests). abortAfterFlushes simulates a client that leaves.
 */
final class BufferSseOutput implements SseOutput
{
    private string $buffer = '';
    /** @var array<string, string> */
    private array $headers = [];
    private int $flushes = 0;

    public function __construct(private ?int $abortAfterFlushes = null)
    {
    }

    /**
     * Records the response headers without sending them.
     */
    public function start(array $headers): void
    {
        $this->headers = $headers;
    }

    /**
     * Appends the data to the in-memory buffer.
     */
    public function write(string $data): void
    {
        $this->buffer .= $data;
    }

    /**
     * Counts the flush instead of pushing data to a client.
     */
    public function flush(): void
    {
        $this->flushes++;
    }

    /**
     * Tells whether the simulated client has disconnected.
     */
    public function aborted(): bool
    {
        return $this->abortAfterFlushes !== null && $this->flushes >= $this->abortAfterFlushes;
    }

    /**
     * Returns everything written so far.
     */
    public function contents(): string
    {
        return $this->buffer;
    }

    /**
     * @return array<string, string>
     */
    public function headers(): array
    {
        return $this->headers;
    }

    /**
     * Returns how many times flush() was called.
     */
    public function flushes(): int
    {
        return $this->flushes;
    }
}
