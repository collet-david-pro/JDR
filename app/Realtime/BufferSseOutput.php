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

    public function start(array $headers): void
    {
        $this->headers = $headers;
    }

    public function write(string $data): void
    {
        $this->buffer .= $data;
    }

    public function flush(): void
    {
        $this->flushes++;
    }

    public function aborted(): bool
    {
        return $this->abortAfterFlushes !== null && $this->flushes >= $this->abortAfterFlushes;
    }

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

    public function flushes(): int
    {
        return $this->flushes;
    }
}
