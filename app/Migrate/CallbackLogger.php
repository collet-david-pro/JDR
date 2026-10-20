<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * MigrationLogger that forwards each entry to a callable and keeps a copy.
 * Without callable, it simply buffers entries (useful for tests and web UIs).
 */
final class CallbackLogger implements MigrationLogger
{
    /** @var (callable(string, array<string, mixed>): void)|null */
    private $callback;

    /** @var list<array{ts:string,msg:string,ctx:array<string, mixed>}> */
    private array $entries = [];

    public function __construct(?callable $callback = null)
    {
        $this->callback = $callback;
    }

    public function info(string $msg, array $ctx = []): void
    {
        $this->entries[] = ['ts' => gmdate('Y-m-d H:i:s'), 'msg' => $msg, 'ctx' => $ctx];
        if ($this->callback !== null) {
            ($this->callback)($msg, $ctx);
        }
    }

    /**
     * @return list<array{ts:string,msg:string,ctx:array<string, mixed>}>
     */
    public function entries(): array
    {
        return $this->entries;
    }
}
