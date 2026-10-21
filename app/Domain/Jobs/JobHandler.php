<?php

declare(strict_types=1);

namespace JDR\Domain\Jobs;

defined('JDR_BOOT') || exit;

/**
 * Work of one job type, run in slices (projet.md 6.5): step() works until $deadline
 * (microtime(true)), updates done/state/result and sets the status to "done" when finished.
 * Exceptions mark the job "failed".
 */
interface JobHandler
{
    public function step(Job $job, float $deadline): void;

    /**
     * Frees the job's resources (files) after a cancellation or a failure.
     */
    public function cleanup(Job $job): void;
}
