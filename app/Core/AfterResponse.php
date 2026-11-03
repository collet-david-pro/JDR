<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Work deferred until the response has left (App::run(): after fastcgi_finish_request() when available).
 * Used where the duration of the work would tell something to the client, e.g. "forgot password" only
 * sends an e-mail when the account exists (docs/securite.md, A07). Tests call run() themselves.
 * A failing task is logged and never stops the next ones.
 */
final class AfterResponse
{
    /** @var list<\Closure(): void> */
    private array $tasks = [];

    public function __construct(private Logger $logger)
    {
    }

    /**
     * @param \Closure(): void $task
     */
    public function defer(\Closure $task): void
    {
        $this->tasks[] = $task;
    }

    public function pending(): int
    {
        return count($this->tasks);
    }

    /**
     * Runs (and forgets) every deferred task; returns how many ran.
     */
    public function run(): int
    {
        $count = 0;
        while ($this->tasks !== []) {
            $task = array_shift($this->tasks);
            $count++;
            try {
                $task();
            } catch (\Throwable $e) {
                $this->logger->error('Deferred task failed', Logger::exceptionContext($e));
            }
        }

        return $count;
    }
}
